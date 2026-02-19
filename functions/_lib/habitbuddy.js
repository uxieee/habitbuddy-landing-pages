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
import { createCheckoutSession } from './stripe.js';

const TAGS = {
  lead: 'hb_lead',
  trialStarted: 'hb_trial_started',
  giftSender: 'hb_gift_sender',
  giftRecipient: 'hb_gift_recipient',
};

const GIFT_PLAN_BY_DURATION = {
  '1month': {
    key: '1month',
    label: '1 Month Gift',
    amount: 29.99,
    priceConfigKey: 'stripeGift1mPriceId',
    stageConfigKey: 'stageMaxSupportPayingId',
  },
  '3months': {
    key: '3months',
    label: '3 Month Gift',
    amount: 79.99,
    priceConfigKey: 'stripeGift3mPriceId',
    stageConfigKey: 'stageThreeMonthPassId',
  },
  '6months': {
    key: '6months',
    label: '6 Month Gift',
    amount: 139,
    priceConfigKey: 'stripeGift6mPriceId',
    stageConfigKey: 'stageThreeMonthPassId',
  },
};

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
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

  return { firstName, email, phone, habitFocus, checkinTime };
}

function normalizeGiftLeadPayload(payload) {
  const senderName = cleanText(payload.sender_name || payload.senderName);
  const senderEmail = cleanEmail(payload.sender_email || payload.senderEmail);
  const recipientName = cleanText(payload.recipient_name || payload.recipientName);
  const recipientPhone = cleanPhone(payload.recipient_phone || payload.recipientPhone);
  const recipientEmail = cleanEmail(payload.recipient_email || payload.recipientEmail);
  const duration = cleanText(payload.gift_duration || payload.giftDuration).toLowerCase();
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

  if (!duration) {
    const error = new Error('Gift duration is required.');
    error.status = 400;
    throw error;
  }

  return {
    senderName,
    senderEmail,
    recipientName,
    recipientPhone,
    recipientEmail,
    duration,
    message,
  };
}

export function resolveGiftPlan(config, duration) {
  const key = String(duration || '').toLowerCase();
  const plan = GIFT_PLAN_BY_DURATION[key];
  if (!plan) {
    const error = new Error('Unsupported gift duration selected.');
    error.status = 400;
    throw error;
  }

  const priceId = config[plan.priceConfigKey];
  if (!priceId) {
    const error = new Error(`${plan.label} is not active yet.`);
    error.status = 400;
    throw error;
  }

  const stageId = config[plan.stageConfigKey];
  if (!stageId) {
    const error = new Error(`Missing stage configuration for ${plan.label}.`);
    error.status = 500;
    throw error;
  }

  return {
    ...plan,
    priceId,
    stageId,
  };
}

function resolveGiftPlanFromMetadata(config, metadata) {
  const duration = cleanText(metadata?.giftDuration || metadata?.gift_duration).toLowerCase();
  if (duration && GIFT_PLAN_BY_DURATION[duration]) {
    return resolveGiftPlan(config, duration);
  }

  const priceId = cleanText(metadata?.giftPriceId || metadata?.priceId);
  if (priceId && priceId === config.stripeGift1mPriceId) {
    return resolveGiftPlan(config, '1month');
  }
  if (priceId && priceId === config.stripeGift3mPriceId) {
    return resolveGiftPlan(config, '3months');
  }
  if (priceId && config.stripeGift6mPriceId && priceId === config.stripeGift6mPriceId) {
    return resolveGiftPlan(config, '6months');
  }

  const error = new Error('Unable to resolve gift plan from checkout metadata.');
  error.status = 400;
  throw error;
}

export async function captureMainLead(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['ghlPrivateToken', 'locationId', 'pipelineId', 'stageAbandonedCartId']);

  const lead = normalizeMainLeadPayload(payload);

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
    name: buildOpportunityName(lead.firstName, 'Max Support'),
    source: 'HabitBuddy Max Support Form',
    monetaryValue: 29.99,
  });

  return {
    lead,
    contact,
    opportunity,
  };
}

export async function captureGiftLead(env, payload) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['ghlPrivateToken', 'locationId', 'pipelineId', 'stageAbandonedCartGiftingId']);

  const lead = normalizeGiftLeadPayload(payload);
  const giftPlan = resolveGiftPlan(config, lead.duration);

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

export async function createMainCheckoutSessionForLead(env, request, payload) {
  const config = getConfig(env, request);
  assertConfig(config, [
    'stripeSecretKey',
    'stripeMainTrialPriceId',
    'mainSuccessUrl',
    'mainCancelUrl',
    'stageMaxSupportTrialId',
  ]);

  const captured = await captureMainLead(env, payload);
  const lead = captured.lead;

  const metadata = {
    flow: 'main_trial',
    locationId: config.locationId,
    pipelineId: config.pipelineId,
    targetStageId: config.stageMaxSupportTrialId,
    contactId: captured.contact.id,
    opportunityId: captured.opportunity.id,
    firstName: lead.firstName,
    phone: lead.phone,
    email: lead.email,
    habitFocus: lead.habitFocus,
    checkinTime: lead.checkinTime,
  };

  const session = await createCheckoutSession(env, {
    mode: 'subscription',
    success_url: config.mainSuccessUrl,
    cancel_url: config.mainCancelUrl,
    allow_promotion_codes: true,
    client_reference_id: captured.contact.id,
    ...(lead.email ? { customer_email: lead.email } : {}),
    phone_number_collection: { enabled: true },
    line_items: [{ price: config.stripeMainTrialPriceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: config.trialPeriodDays,
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

  const metadata = {
    flow: 'gift_purchase',
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
      stageId: config.stageMaxSupportTrialId,
      name: buildOpportunityName(cleanText(metadata.firstName || 'Member'), 'Max Support (Trial)'),
      source: 'HabitBuddy Main Checkout',
      monetaryValue: 29.99,
    });
    opportunityId = opportunity.id;
  } else {
    opportunity = await safeUpdateOpportunity(env, opportunity.id, {
      pipelineId: config.pipelineId,
      pipelineStageId: config.stageMaxSupportTrialId,
      status: 'open',
      monetaryValue: 29.99,
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
      monetaryValue: giftPlan.amount,
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
      monetaryValue: giftPlan.amount,
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
