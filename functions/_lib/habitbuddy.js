import { getConfig, assertConfig, buildOpportunityName } from './config.js';
import {
  upsertContact,
  updateContact,
  addContactTags,
  searchOpportunities,
  createOpportunity,
  updateOpportunity,
  getOpportunity,
  getRelationsForRecord,
  createAssociationRelation,
  deleteAssociationRelation,
  ensureGiftContactAssociation,
  isDuplicateRelationError,
  isRelationNotFoundError,
} from './ghl.js';
import {
  createCheckoutSession,
  createCustomer,
  createSetupIntent,
  retrieveSetupIntent,
  createSubscription,
  createPaymentIntent,
  retrievePaymentIntent,
  retrievePrice,
} from './stripe.js';

const TAGS = {
  lead: 'hb_lead',
  trialStarted: 'hb_trial_started',
  giftSender: 'hb_gift_sender',
  giftRecipient: 'hb_gift_recipient',
};

const MAIN_TRIAL_PLAN_KEY = 'main_trial';

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizePlanReference(value) {
  return cleanText(value).toLowerCase();
}

function toFiniteNumber(value, fallbackValue = undefined) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return fallbackValue;
}

function listPlans(config, type) {
  const plans = Object.values(config?.planCatalog || {}).filter((plan) => plan && typeof plan === 'object');
  if (!type) return plans;
  return plans.filter((plan) => normalizePlanReference(plan.type) === normalizePlanReference(type));
}

function doesPlanMatchReference(plan, normalizedReference) {
  if (!plan || !normalizedReference) return false;
  if (normalizePlanReference(plan.key) === normalizedReference) return true;
  const aliases = Array.isArray(plan.aliases) ? plan.aliases : [];
  return aliases.some((alias) => normalizePlanReference(alias) === normalizedReference);
}

function resolvePlan(config, planReference, type, fallbackPlanKey = '') {
  const normalizedReference = normalizePlanReference(planReference) || normalizePlanReference(fallbackPlanKey);
  const plans = listPlans(config, type);
  const matchedPlan = plans.find((plan) => doesPlanMatchReference(plan, normalizedReference));

  if (!matchedPlan) {
    const error = new Error(type === 'gift' ? 'Unsupported gift duration selected.' : 'Unsupported plan selected.');
    error.status = 400;
    throw error;
  }

  const label = cleanText(matchedPlan.label || matchedPlan.key || 'Selected plan');
  const priceId = cleanText(matchedPlan.priceId);
  if (!priceId) {
    const error = new Error(`${label} is not active yet.`);
    error.status = 400;
    throw error;
  }

  const stageId = cleanText(matchedPlan.stageId);
  if (!stageId) {
    const error = new Error(`Missing stage configuration for ${label}.`);
    error.status = 500;
    throw error;
  }

  const amount = toFiniteNumber(matchedPlan.amount);
  const trialPeriodDays = toFiniteNumber(matchedPlan.trialPeriodDays);

  return {
    ...matchedPlan,
    key: normalizePlanReference(matchedPlan.key || normalizedReference),
    label,
    type: normalizePlanReference(matchedPlan.type) || type,
    mode: normalizePlanReference(matchedPlan.mode),
    priceId,
    stageId,
    ...(Number.isFinite(amount) ? { amount } : {}),
    ...(Number.isFinite(trialPeriodDays) && trialPeriodDays > 0 ? { trialPeriodDays: Math.floor(trialPeriodDays) } : {}),
  };
}

function resolveMainPlan(config, planReference) {
  return resolvePlan(config, planReference, 'main', MAIN_TRIAL_PLAN_KEY);
}

export function resolveGiftPlan(config, planReference) {
  return resolvePlan(config, planReference, 'gift');
}

function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

function cleanPhone(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  return raw.replace(/[\s()\-]/g, '');
}

function splitName(fullName) {
  const name = cleanText(fullName);
  if (!name) return { firstName: '', lastName: '' };
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function listOpportunityCustomFields(config, fields) {
  const mapped = [
    { id: config.oppGiftingFlagFieldId, value: fields.giftingFlag },
    { id: config.oppRecipientNameFieldId, value: fields.recipientName },
    { id: config.oppRecipientEmailFieldId, value: fields.recipientEmail },
    { id: config.oppRecipientPhoneFieldId, value: fields.recipientPhone },
    { id: config.oppGifterNameFieldId, value: fields.gifterName },
    { id: config.oppGifterEmailFieldId, value: fields.gifterEmail },
    { id: config.oppWasGiftedFieldId, value: fields.wasGifted },
  ];
  return mapped.filter((item) => item.id && item.value !== undefined && item.value !== null && item.value !== '');
}

function listRecipientContactCustomFields(config, recipient) {
  const mapped = [
    { id: config.contactRecipientNameFieldId, value: recipient.name },
    { id: config.contactRecipientPhoneFieldId, value: recipient.phone },
    { id: config.contactRecipientEmailFieldId, value: recipient.email },
  ];
  return mapped.filter((item) => item.id && item.value);
}

async function safeAddTags(env, contactId, tags) {
  try {
    await addContactTags(env, contactId, tags);
  } catch (error) {
    console.warn('Tag write failed (non-blocking):', error?.message || error);
  }
}

async function safeUpdateContact(env, contactId, payload) {
  try {
    await updateContact(env, contactId, payload);
  } catch (error) {
    console.warn('Contact update failed (non-blocking):', error?.message || error);
  }
}

async function safeUpdateOpportunity(env, opportunityId, payload) {
  try {
    return await updateOpportunity(env, opportunityId, payload);
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('custom field') && Array.isArray(payload.customFields)) {
      const clone = { ...payload };
      delete clone.customFields;
      return updateOpportunity(env, opportunityId, clone);
    }
    throw error;
  }
}

async function findOpenOpportunity(env, contactId, pipelineId) {
  const opportunities = await searchOpportunities(env, {
    contactId,
    pipelineId,
    status: 'open',
    limit: 50,
  });

  if (!opportunities || opportunities.length === 0) {
    return null;
  }

  return opportunities[0];
}

async function upsertOpportunityAtStage(env, params) {
  const { contactId, stageId, name, source, monetaryValue, customFields } = params;
  const config = getConfig(env, { url: 'https://example.com' });

  const existing = await findOpenOpportunity(env, contactId, config.pipelineId);
  if (existing) {
    const updated = await safeUpdateOpportunity(env, existing.id, {
      pipelineId: config.pipelineId,
      pipelineStageId: stageId,
      status: 'open',
      name: name || existing.name,
      monetaryValue: monetaryValue ?? existing.monetaryValue,
      ...(customFields?.length ? { customFields } : {}),
    });
    return updated;
  }

  return createOpportunity(env, {
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    pipelineStageId: stageId,
    status: 'open',
    contactId,
    name,
    source,
    monetaryValue,
    ...(customFields?.length ? { customFields } : {}),
  });
}

function normalizeMainLeadPayload(payload) {
  const firstName = cleanText(payload.first_name || payload.firstName);
  const email = cleanEmail(payload.email);
  const phone = cleanPhone(payload.phone);
  const habitFocus = cleanText(payload.habit_focus || payload.habitFocus);
  const checkinTime = cleanText(payload.checkin_time || payload.checkinTime);
  const planKey = normalizePlanReference(payload.plan_key || payload.planKey || MAIN_TRIAL_PLAN_KEY);

  if (!firstName) {
    const error = new Error('First name is required.');
    error.status = 400;
    throw error;
  }

  if (!phone) {
    const error = new Error('Phone number is required.');
    error.status = 400;
    throw error;
  }

  return { firstName, email, phone, habitFocus, checkinTime, planKey };
}

function normalizeGiftLeadPayload(payload) {
  const senderName = cleanText(payload.sender_name || payload.senderName);
  const senderEmail = cleanEmail(payload.sender_email || payload.senderEmail);
  const recipientName = cleanText(payload.recipient_name || payload.recipientName);
  const recipientPhone = cleanPhone(payload.recipient_phone || payload.recipientPhone);
  const recipientEmail = cleanEmail(payload.recipient_email || payload.recipientEmail);
  const planKey = normalizePlanReference(payload.plan_key || payload.planKey || payload.gift_duration || payload.giftDuration);
  const message = cleanText(payload.gift_message || payload.giftMessage);

  if (!senderName) {
    const error = new Error('Sender name is required.');
    error.status = 400;
    throw error;
  }

  if (!senderEmail) {
    const error = new Error('Sender email is required.');
    error.status = 400;
    throw error;
  }

  if (!recipientName) {
    const error = new Error('Recipient name is required.');
    error.status = 400;
    throw error;
  }

  if (!recipientPhone) {
    const error = new Error('Recipient phone is required.');
    error.status = 400;
    throw error;
  }

  if (!planKey) {
    const error = new Error('Gift plan is required.');
    error.status = 400;
    throw error;
  }

  return {
    senderName,
    senderEmail,
    recipientName,
    recipientPhone,
    recipientEmail,
    planKey,
    message,
  };
}

function resolveGiftPlanFromMetadata(config, metadata) {
  const planCandidates = [
    metadata?.planKey,
    metadata?.plan_key,
    metadata?.giftPlanKey,
    metadata?.gift_plan_key,
    metadata?.giftDuration,
    metadata?.gift_duration,
  ]
    .map((candidate) => normalizePlanReference(candidate))
    .filter(Boolean);

  for (const candidate of planCandidates) {
    try {
      return resolveGiftPlan(config, candidate);
    } catch (error) {
      const message = String(error?.message || '');
      if (error?.status === 400 && message.includes('Unsupported gift duration selected.')) continue;
      throw error;
    }
  }

  const priceId = cleanText(metadata?.giftPriceId || metadata?.priceId);
  if (priceId) {
    const match = listPlans(config, 'gift').find((plan) => cleanText(plan.priceId) === priceId);
    if (match?.key) {
      return resolveGiftPlan(config, match.key);
    }
  }

  const error = new Error('Unable to resolve gift plan from checkout metadata.');
  error.status = 400;
  throw error;
}

export async function captureMainLead(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['ghlPrivateToken', 'locationId', 'pipelineId', 'stageAbandonedCartId']);

  const lead = normalizeMainLeadPayload(payload);
  const mainPlan = resolveMainPlan(config, lead.planKey);

  const contact = await upsertContact(env, {
    locationId: config.locationId,
    firstName: lead.firstName,
    email: lead.email || undefined,
    phone: lead.phone,
    source: 'HabitBuddy Max Support Form',
  });

  await safeAddTags(env, contact.id, [TAGS.lead]);

  const opportunity = await upsertOpportunityAtStage(env, {
    contactId: contact.id,
    stageId: config.stageAbandonedCartId,
    name: buildOpportunityName(lead.firstName, mainPlan.label || 'Max Support'),
    source: 'HabitBuddy Max Support Form',
    monetaryValue: mainPlan.amount,
  });

  return {
    lead,
    mainPlan,
    contact,
    opportunity,
  };
}

export async function captureGiftLead(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['ghlPrivateToken', 'locationId', 'pipelineId', 'stageAbandonedCartGiftingId']);

  const lead = normalizeGiftLeadPayload(payload);
  const giftPlan = resolveGiftPlan(config, lead.planKey);

  const senderNameParts = splitName(lead.senderName);
  const gifterContact = await upsertContact(env, {
    locationId: config.locationId,
    firstName: senderNameParts.firstName || lead.senderName,
    lastName: senderNameParts.lastName || undefined,
    email: lead.senderEmail,
    source: 'HabitBuddy Gift Form',
  });

  await safeAddTags(env, gifterContact.id, [TAGS.lead, TAGS.giftSender]);

  await safeUpdateContact(env, gifterContact.id, {
    customFields: listRecipientContactCustomFields(config, {
      name: lead.recipientName,
      email: lead.recipientEmail,
      phone: lead.recipientPhone,
    }),
  });

  const opportunity = await upsertOpportunityAtStage(env, {
    contactId: gifterContact.id,
    stageId: config.stageAbandonedCartGiftingId,
    name: buildOpportunityName(lead.senderName, `${lead.recipientName} Gift`),
    source: 'HabitBuddy Gift Form',
    monetaryValue: giftPlan.amount,
    customFields: listOpportunityCustomFields(config, {
      giftingFlag: 'Yes',
      recipientName: lead.recipientName,
      recipientEmail: lead.recipientEmail,
      recipientPhone: lead.recipientPhone,
      gifterName: lead.senderName,
      gifterEmail: lead.senderEmail,
      wasGifted: 'No',
    }),
  });

  return {
    lead,
    giftPlan,
    gifterContact,
    opportunity,
  };
}

function buildMainFlowMetadata(config, captured, lead, plan) {
  return {
    flow: 'main_trial',
    planKey: plan.key,
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    targetStageId: plan.stageId,
    contactId: captured.contact.id,
    opportunityId: captured.opportunity.id,
    firstName: lead.firstName,
    phone: lead.phone,
    email: lead.email,
    habitFocus: lead.habitFocus,
    checkinTime: lead.checkinTime,
  };
}

function buildGiftFlowMetadata(config, captured, lead, plan) {
  return {
    flow: 'gift_purchase',
    planKey: plan.key,
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    gifterContactId: captured.gifterContact.id,
    opportunityId: captured.opportunity.id,
    giftDuration: plan.key,
    giftPriceId: plan.priceId,
    targetStageId: plan.stageId,
    senderName: lead.senderName,
    senderEmail: lead.senderEmail,
    recipientName: lead.recipientName,
    recipientPhone: lead.recipientPhone,
    recipientEmail: lead.recipientEmail,
    giftMessage: lead.message,
  };
}

function toStripeAmountCents(amount) {
  const numeric = toFiniteNumber(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error('Gift amount configuration is invalid.');
    error.status = 500;
    throw error;
  }
  return Math.round(numeric * 100);
}

function centsToAmount(cents, fallbackAmount) {
  const numeric = toFiniteNumber(cents);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallbackAmount;
  return Math.round((numeric / 100) * 100) / 100;
}

async function resolvePriceAmountCents(env, priceId, fallbackAmount) {
  const validPriceId = cleanText(priceId);
  if (!validPriceId) {
    return toStripeAmountCents(fallbackAmount);
  }

  try {
    const price = await retrievePrice(env, validPriceId);
    const unitAmount = toFiniteNumber(price?.unit_amount);
    if (Number.isFinite(unitAmount) && unitAmount > 0) {
      return Math.round(unitAmount);
    }

    const unitAmountDecimal = toFiniteNumber(price?.unit_amount_decimal);
    if (Number.isFinite(unitAmountDecimal) && unitAmountDecimal > 0) {
      return Math.round(unitAmountDecimal);
    }
  } catch (error) {
    console.warn('Price amount lookup failed, using configured fallback:', error?.message || error);
  }

  return toStripeAmountCents(fallbackAmount);
}

function resolveSessionAmount(session, fallbackAmount) {
  const candidates = [
    session?.amount_total,
    session?.amount_subtotal,
    session?.amount_received,
    session?.amount,
  ];
  for (const candidate of candidates) {
    const numeric = toFiniteNumber(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return centsToAmount(numeric, fallbackAmount);
    }
  }
  return fallbackAmount;
}

function ensureStripeResourceId(rawId, expectedPrefix, fieldLabel) {
  const id = cleanText(rawId);
  if (!id || !id.startsWith(`${expectedPrefix}_`)) {
    const error = new Error(`${fieldLabel} is invalid.`);
    error.status = 400;
    throw error;
  }
  return id;
}

function setupIntentToSessionLike(setupIntent, metadataOverrides = {}) {
  const metadata = {
    ...(setupIntent?.metadata || {}),
    ...metadataOverrides,
  };
  const paymentMethod = setupIntent?.payment_method || {};
  const billing = paymentMethod?.billing_details || {};

  return {
    metadata,
    customer_email: billing.email || metadata.email || undefined,
    customer_details: {
      email: billing.email || metadata.email || undefined,
      phone: billing.phone || metadata.phone || undefined,
      name: billing.name || metadata.firstName || undefined,
    },
  };
}

function paymentIntentToSessionLike(paymentIntent, metadataOverrides = {}) {
  const metadata = {
    ...(paymentIntent?.metadata || {}),
    ...metadataOverrides,
  };
  const charge = paymentIntent?.latest_charge || {};
  const billing = charge?.billing_details || {};

  return {
    metadata,
    amount_total: paymentIntent?.amount_received || paymentIntent?.amount || undefined,
    amount_received: paymentIntent?.amount_received || undefined,
    amount: paymentIntent?.amount || undefined,
    customer_email: billing.email || metadata.senderEmail || metadata.sender_email || undefined,
    customer_details: {
      email: billing.email || metadata.senderEmail || metadata.sender_email || undefined,
      phone: billing.phone || metadata.recipientPhone || metadata.recipient_phone || undefined,
      name: billing.name || metadata.senderName || metadata.sender_name || undefined,
    },
  };
}

export async function createMainCheckoutSessionForLead(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'mainSuccessUrl', 'mainCancelUrl']);

  const captured = await captureMainLead(env, payload);
  const lead = captured.lead;
  const plan = captured.mainPlan || resolveMainPlan(config, lead.planKey);

  if (plan.mode && plan.mode !== 'subscription') {
    const error = new Error(`Main plan "${plan.label}" must use subscription mode.`);
    error.status = 500;
    throw error;
  }

  const metadata = buildMainFlowMetadata(config, captured, lead, plan);

  const session = await createCheckoutSession(env, {
    mode: 'subscription',
    success_url: config.mainSuccessUrl,
    cancel_url: config.mainCancelUrl,
    allow_promotion_codes: true,
    client_reference_id: captured.contact.id,
    ...(lead.email ? { customer_email: lead.email } : {}),
    phone_number_collection: { enabled: true },
    line_items: [{ price: plan.priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: plan.trialPeriodDays || config.trialPeriodDays,
      metadata,
    },
    metadata,
  });

  return {
    captured,
    session,
  };
}

export async function createGiftCheckoutSessionForLead(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'giftSuccessUrl', 'giftCancelUrl']);

  const captured = await captureGiftLead(env, payload);
  const lead = captured.lead;
  const plan = captured.giftPlan;

  if (plan.mode && plan.mode !== 'payment') {
    const error = new Error(`Gift plan "${plan.label}" must use payment mode.`);
    error.status = 500;
    throw error;
  }

  const metadata = buildGiftFlowMetadata(config, captured, lead, plan);

  const session = await createCheckoutSession(env, {
    mode: 'payment',
    success_url: config.giftSuccessUrl,
    cancel_url: config.giftCancelUrl,
    allow_promotion_codes: true,
    client_reference_id: captured.opportunity.id,
    customer_email: lead.senderEmail,
    line_items: [{ price: plan.priceId, quantity: 1 }],
    metadata,
  });

  return {
    captured,
    session,
  };
}

export async function createMainSetupIntentForLead(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'stripePublishableKey', 'ghlPrivateToken', 'locationId', 'pipelineId']);

  const captured = await captureMainLead(env, payload);
  const lead = captured.lead;
  const plan = captured.mainPlan || resolveMainPlan(config, lead.planKey);

  if (plan.mode && plan.mode !== 'subscription') {
    const error = new Error(`Main plan "${plan.label}" must use subscription mode.`);
    error.status = 500;
    throw error;
  }

  const metadata = buildMainFlowMetadata(config, captured, lead, plan);
  const customer = await createCustomer(env, {
    name: lead.firstName,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    metadata: {
      flow: metadata.flow,
      planKey: metadata.planKey,
      contactId: metadata.contactId,
      opportunityId: metadata.opportunityId,
    },
  });

  const setupIntent = await createSetupIntent(env, {
    customer: customer.id,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata,
  });

  return {
    captured,
    plan,
    customerId: customer.id,
    setupIntent,
    publishableKey: config.stripePublishableKey,
  };
}

export async function activateMainSubscriptionFromSetupIntent(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'ghlPrivateToken', 'locationId', 'pipelineId']);

  const setupIntentId = ensureStripeResourceId(
    payload.setupIntentId || payload.setup_intent_id,
    'seti',
    'Setup intent',
  );
  const setupIntent = await retrieveSetupIntent(env, setupIntentId, { expand: ['payment_method'] });

  if (cleanText(setupIntent?.status) !== 'succeeded') {
    const error = new Error('Card setup is not complete yet.');
    error.status = 400;
    throw error;
  }

  const metadata = setupIntent?.metadata || {};
  const plan = resolveMainPlan(config, payload.plan_key || payload.planKey || metadata.planKey || MAIN_TRIAL_PLAN_KEY);
  const customerId = cleanText(setupIntent?.customer);
  const paymentMethodId = cleanText(setupIntent?.payment_method?.id || setupIntent?.payment_method);

  if (!customerId || !paymentMethodId) {
    const error = new Error('Setup intent is missing customer or payment method.');
    error.status = 400;
    throw error;
  }

  const mergedMetadata = {
    ...metadata,
    flow: 'main_trial',
    planKey: plan.key,
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    targetStageId: plan.stageId,
  };

  const subscription = await createSubscription(env, {
    customer: customerId,
    items: [{ price: plan.priceId }],
    trial_period_days: plan.trialPeriodDays || config.trialPeriodDays,
    default_payment_method: paymentMethodId,
    payment_settings: {
      save_default_payment_method: 'on_subscription',
    },
    metadata: mergedMetadata,
  });

  const postPurchase = await processMainCheckoutCompleted(
    env,
    setupIntentToSessionLike(setupIntent, mergedMetadata),
  );

  return {
    subscriptionId: subscription?.id,
    status: subscription?.status,
    planKey: plan.key,
    ...postPurchase,
  };
}

export async function createGiftPaymentIntentForLead(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'stripePublishableKey', 'ghlPrivateToken', 'locationId', 'pipelineId']);

  const captured = await captureGiftLead(env, payload);
  const lead = captured.lead;
  const plan = captured.giftPlan;

  if (plan.mode && plan.mode !== 'payment') {
    const error = new Error(`Gift plan "${plan.label}" must use payment mode.`);
    error.status = 500;
    throw error;
  }

  const amountCents = await resolvePriceAmountCents(env, plan.priceId, plan.amount);
  const amountValue = centsToAmount(amountCents, plan.amount);
  if (captured?.opportunity?.id && Number.isFinite(amountValue)) {
    await safeUpdateOpportunity(env, captured.opportunity.id, {
      pipelineId: config.pipelineId,
      pipelineStageId: config.stageAbandonedCartGiftingId,
      status: 'open',
      monetaryValue: amountValue,
    });
  }

  const metadata = buildGiftFlowMetadata(config, captured, lead, plan);
  const paymentIntent = await createPaymentIntent(env, {
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card'],
    receipt_email: lead.senderEmail || undefined,
    description: `${plan.label} - Habit Buddy Gift`,
    metadata,
  });

  return {
    captured,
    plan: {
      ...plan,
      amount: amountValue,
    },
    paymentIntent,
    publishableKey: config.stripePublishableKey,
  };
}

export async function finalizeGiftPaymentIntent(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, ['stripeSecretKey', 'ghlPrivateToken', 'locationId', 'pipelineId']);

  const paymentIntentId = ensureStripeResourceId(
    payload.paymentIntentId || payload.payment_intent_id,
    'pi',
    'Payment intent',
  );
  const paymentIntent = await retrievePaymentIntent(env, paymentIntentId, { expand: ['latest_charge'] });

  const status = cleanText(paymentIntent?.status);
  if (status !== 'succeeded') {
    const error = new Error(`Payment is not complete yet (status: ${status || 'unknown'}).`);
    error.status = 400;
    throw error;
  }

  const result = await processGiftCheckoutCompleted(env, paymentIntentToSessionLike(paymentIntent));
  return {
    paymentIntentId,
    status,
    ...result,
  };
}

async function reassignOpportunityToRecipient(env, params) {
  const { opportunityId, oldContactId, newContactId, pipelineId } = params;
  if (!opportunityId || !newContactId || oldContactId === newContactId) return;

  if (oldContactId) {
    try {
      await deleteAssociationRelation(env, {
        associationId: 'OPPORTUNITIES_CONTACTS_ASSOCIATION',
        firstRecordId: opportunityId,
        secondRecordId: oldContactId,
        pipelineId,
      });
    } catch (error) {
      if (!isRelationNotFoundError(error)) {
        throw error;
      }
    }
  }

  try {
    await createAssociationRelation(env, {
      associationId: 'OPPORTUNITIES_CONTACTS_ASSOCIATION',
      firstRecordId: opportunityId,
      secondRecordId: newContactId,
      pipelineId,
    });
  } catch (error) {
    if (!isDuplicateRelationError(error)) {
      throw error;
    }
  }
}

async function linkGifterAndRecipientContacts(env, gifterContactId, recipientContactId) {
  if (!gifterContactId || !recipientContactId || gifterContactId === recipientContactId) return;

  const association = await ensureGiftContactAssociation(env);
  if (!association?.id) return;

  try {
    await createAssociationRelation(env, {
      associationId: association.id,
      firstRecordId: gifterContactId,
      secondRecordId: recipientContactId,
    });
  } catch (error) {
    if (!isDuplicateRelationError(error)) {
      throw error;
    }
  }
}

function normalizeSessionEmail(session) {
  return cleanEmail(
    session?.customer_details?.email ||
      session?.customer_email ||
      session?.metadata?.email ||
      session?.metadata?.senderEmail ||
      session?.metadata?.sender_email,
  );
}

function normalizeSessionPhone(session) {
  return cleanPhone(
    session?.customer_details?.phone ||
      session?.metadata?.phone ||
      session?.metadata?.recipientPhone ||
      session?.metadata?.recipient_phone,
  );
}

export async function processMainCheckoutCompleted(env, session) {
  const config = getConfig(env, { url: 'https://example.com' });

  const metadata = session?.metadata || {};
  const plan = resolveMainPlan(config, metadata.planKey || metadata.plan_key || MAIN_TRIAL_PLAN_KEY);
  let contactId = cleanText(metadata.contactId || metadata.contact_id);
  let opportunityId = cleanText(metadata.opportunityId || metadata.opportunity_id);

  if (!contactId) {
    const email = normalizeSessionEmail(session);
    const phone = normalizeSessionPhone(session);
    const firstName = cleanText(metadata.firstName || metadata.first_name || 'HabitBuddy Member');

    if (!email && !phone) {
      const error = new Error('Main checkout completed without contact identifiers.');
      error.status = 400;
      throw error;
    }

    const contact = await upsertContact(env, {
      locationId: config.locationId,
      firstName,
      email: email || undefined,
      phone: phone || undefined,
      source: 'HabitBuddy Main Checkout',
    });
    contactId = contact.id;
  }

  let opportunity = null;
  if (opportunityId) {
    try {
      opportunity = await getOpportunity(env, opportunityId);
    } catch (_error) {
      opportunity = null;
    }
  }

  if (!opportunity) {
    opportunity = await upsertOpportunityAtStage(env, {
      contactId,
      stageId: plan.stageId,
      name: buildOpportunityName(cleanText(metadata.firstName || 'Member'), plan.label),
      source: 'HabitBuddy Main Checkout',
      monetaryValue: plan.amount,
    });
    opportunityId = opportunity.id;
  } else {
    opportunity = await safeUpdateOpportunity(env, opportunity.id, {
      pipelineId: config.pipelineId,
      pipelineStageId: plan.stageId,
      status: 'open',
      monetaryValue: plan.amount,
    });
  }

  await safeAddTags(env, contactId, [TAGS.trialStarted]);

  return {
    contactId,
    opportunityId,
  };
}

export async function processGiftCheckoutCompleted(env, session) {
  const config = getConfig(env, { url: 'https://example.com' });
  const metadata = session?.metadata || {};

  const senderName = cleanText(metadata.senderName || metadata.sender_name);
  const senderEmail = cleanEmail(metadata.senderEmail || metadata.sender_email);
  const recipientName = cleanText(metadata.recipientName || metadata.recipient_name);
  const recipientEmail = cleanEmail(metadata.recipientEmail || metadata.recipient_email);
  const recipientPhone = cleanPhone(metadata.recipientPhone || metadata.recipient_phone || session?.customer_details?.phone);

  const giftPlan = resolveGiftPlanFromMetadata(config, metadata);
  const resolvedAmount = resolveSessionAmount(session, giftPlan.amount);

  let gifterContactId = cleanText(metadata.gifterContactId || metadata.gifter_contact_id);
  if (!gifterContactId && senderEmail) {
    const senderParts = splitName(senderName || 'Gift Sender');
    const gifterContact = await upsertContact(env, {
      locationId: config.locationId,
      firstName: senderParts.firstName || senderName || 'Gift',
      lastName: senderParts.lastName || undefined,
      email: senderEmail,
      source: 'HabitBuddy Gift Checkout',
    });
    gifterContactId = gifterContact.id;
  }

  const recipientParts = splitName(recipientName || 'Gift Recipient');
  const recipientContact = await upsertContact(env, {
    locationId: config.locationId,
    firstName: recipientParts.firstName || recipientName || 'Gift',
    lastName: recipientParts.lastName || undefined,
    email: recipientEmail || undefined,
    phone: recipientPhone || undefined,
    source: 'HabitBuddy Gift Checkout',
    customFields: listRecipientContactCustomFields(config, {
      name: recipientName,
      email: recipientEmail,
      phone: recipientPhone,
    }),
  });

  await safeAddTags(env, recipientContact.id, [TAGS.giftRecipient]);
  if (gifterContactId) {
    await safeAddTags(env, gifterContactId, [TAGS.giftSender]);
  }

  if (gifterContactId) {
    await linkGifterAndRecipientContacts(env, gifterContactId, recipientContact.id);
  }

  let opportunityId = cleanText(metadata.opportunityId || metadata.opportunity_id);
  let opportunity = null;
  if (opportunityId) {
    try {
      opportunity = await getOpportunity(env, opportunityId);
    } catch (_error) {
      opportunity = null;
    }
  }

  if (!opportunity) {
    opportunity = await createOpportunity(env, {
      locationId: config.locationId,
      pipelineId: config.pipelineId,
      pipelineStageId: giftPlan.stageId,
      status: 'open',
      contactId: recipientContact.id,
      name: buildOpportunityName(recipientName || 'Recipient', giftPlan.label),
      source: 'HabitBuddy Gift Checkout',
      monetaryValue: resolvedAmount,
      customFields: listOpportunityCustomFields(config, {
        giftingFlag: 'Yes',
        recipientName,
        recipientEmail,
        recipientPhone,
        gifterName: senderName,
        gifterEmail: senderEmail,
        wasGifted: 'Yes',
      }),
    });
    opportunityId = opportunity.id;
  } else {
    let oldContactId = gifterContactId;

    if (!oldContactId) {
      try {
        const relations = await getRelationsForRecord(env, opportunity.id);
        const primaryRelation = relations.find((item) => item.associationId === 'OPPORTUNITIES_CONTACTS_ASSOCIATION');
        oldContactId = primaryRelation?.secondRecordId || '';
      } catch (_error) {
        oldContactId = '';
      }
    }

    await reassignOpportunityToRecipient(env, {
      opportunityId: opportunity.id,
      oldContactId,
      newContactId: recipientContact.id,
      pipelineId: config.pipelineId,
    });

    opportunity = await safeUpdateOpportunity(env, opportunity.id, {
      pipelineId: config.pipelineId,
      pipelineStageId: giftPlan.stageId,
      status: 'open',
      monetaryValue: resolvedAmount,
      name: buildOpportunityName(recipientName || senderName || 'Gift', giftPlan.label),
      customFields: listOpportunityCustomFields(config, {
        giftingFlag: 'Yes',
        recipientName,
        recipientEmail,
        recipientPhone,
        gifterName: senderName,
        gifterEmail: senderEmail,
        wasGifted: 'Yes',
      }),
    });
  }

  return {
    gifterContactId,
    recipientContactId: recipientContact.id,
    opportunityId,
    giftPlan: giftPlan.key,
  };
}
