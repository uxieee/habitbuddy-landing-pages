const DEFAULTS = {
  GHL_API_BASE: 'https://services.leadconnectorhq.com',
  STRIPE_API_BASE: 'https://api.stripe.com/v1',
  STRIPE_PUBLISHABLE_KEY: '',
  TURNSTILE_SITE_KEY: '',
  TURNSTILE_SECRET_KEY: '',
  TURNSTILE_ENFORCEMENT: '',

  GHL_LOCATION_ID: '3ouY0YkB0fLDFs5nb8UG',
  GHL_PIPELINE_ID: 'fQzLboVKi639klKBI64N',

  GHL_STAGE_ABANDONED_CART_ID: 'c2e2a8b3-c24c-4aaa-b1a2-7c4a7058fad7',
  GHL_STAGE_ABANDONED_CART_GIFTING_ID: '0c44c2e9-bd2f-4268-9b4d-b0e7fd2310f3',
  GHL_STAGE_MAX_SUPPORT_TRIAL_ID: '29d60203-9e41-4678-80db-4b96b9c17fbf',
  GHL_STAGE_MAX_SUPPORT_PAYING_ID: '7715d018-dcba-4037-b261-aa0f7ffeba83',
  GHL_STAGE_THREE_MONTH_PASS_ID: '62071a34-2e22-41a6-8fcb-450ea698f29e',
  GHL_STAGE_SIX_MONTH_PASS_ID: 'a637ae2a-2ac4-4657-863e-576d3d0ea727',

  STRIPE_MAIN_TRIAL_PRICE_ID: '',
  STRIPE_GIFT_1M_PRICE_ID: '',
  STRIPE_GIFT_3M_PRICE_ID: '',
  STRIPE_GIFT_6M_PRICE_ID: '',
  HB_PLAN_CATALOG_JSON: '',

  TRIAL_PERIOD_DAYS: '7',
  MAX_JSON_BODY_BYTES: '32768',
  RATE_LIMIT_WINDOW_SECONDS: '60',
  RATE_LIMIT_MAX_REQUESTS: '30',
  ALLOWED_ORIGINS: '',
  REQUIRE_ORIGIN_HEADER: 'false',
  HEALTH_STATUS_KEY: '',

  GHL_CF_CONTACT_HB_RECIPIENT_NAME: 'KkAwb02d4X3nV5OSwo3x',
  GHL_CF_CONTACT_HB_RECIPIENT_PHONE: 'WJIGSxaDOfRjqqfURgX6',
  GHL_CF_CONTACT_HB_RECIPIENT_EMAIL: 'zxr42gmeJnJm5zUP7RhW',

  GHL_CF_OPP_GIFTING_FLAG: 'Y083KS6GHkYIzQaSdiHF',
  GHL_CF_OPP_RECIPIENT_NAME: 'w5duMynuqE6MyReMK97A',
  GHL_CF_OPP_RECIPIENT_EMAIL: '77ekenM9Rrflgent0HwO',
  GHL_CF_OPP_RECIPIENT_PHONE: 'Yh7l9Phg6LUPME4G5jBX',
  GHL_CF_OPP_GIFTER_NAME: 'WShMHkb20MzhaRXcVKyU',
  GHL_CF_OPP_GIFTER_EMAIL: 'w4H8YyA4GiPOWVbcznXw',
  GHL_CF_OPP_WAS_GIFTED: 'cQJYSdGsL3icYf9tUbOZ',
};

function readEnv(env, key) {
  const raw = env?.[key];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw.trim();
  }
  return DEFAULTS[key] ?? '';
}

function cleanText(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toFiniteNumber(value, fallbackValue) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  return fallbackValue;
}

function toPositiveInteger(value, fallbackValue) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return fallbackValue;
}

function toBoolean(value, fallbackValue = false) {
  if (typeof value === 'boolean') return value;
  const raw = cleanText(value).toLowerCase();
  if (!raw) return fallbackValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallbackValue;
}

function normalizeOrigin(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  try {
    return new URL(raw).origin;
  } catch (_error) {
    return '';
  }
}

function parseCsvOrigins(value) {
  const raw = cleanText(value);
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);
}

function uniqueStrings(values = []) {
  return [...new Set((values || []).filter(Boolean))];
}

function normalizeAliases(key, aliases = []) {
  const items = [key, ...(Array.isArray(aliases) ? aliases : [])]
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean);
  return [...new Set(items)];
}

function normalizePlanDefinition(key, rawPlan = {}, fallback = {}) {
  const normalizedKey = cleanText(rawPlan.key || key).toLowerCase() || cleanText(fallback.key || key).toLowerCase();
  const normalizedType = cleanText(rawPlan.type || fallback.type).toLowerCase();
  const type = normalizedType === 'main' ? 'main' : 'gift';
  const normalizedMode = cleanText(rawPlan.mode || fallback.mode).toLowerCase();
  const mode = normalizedMode || (type === 'main' ? 'subscription' : 'payment');

  const amountValue = rawPlan.amount ?? fallback.amount;
  const amount = toFiniteNumber(amountValue, null);

  const trialDaysRaw = rawPlan.trialPeriodDays ?? rawPlan.trialDays ?? fallback.trialPeriodDays;
  const trialPeriodDays = toPositiveInteger(trialDaysRaw, undefined);

  return {
    key: normalizedKey,
    type,
    mode,
    label: cleanText(rawPlan.label || fallback.label || normalizedKey),
    priceId: cleanText(rawPlan.priceId ?? fallback.priceId),
    stageId: cleanText(rawPlan.stageId ?? fallback.stageId),
    amount: amount === null ? undefined : amount,
    trialPeriodDays,
    aliases: normalizeAliases(normalizedKey, rawPlan.aliases ?? fallback.aliases),
  };
}

function parsePlanCatalogJson(rawJson) {
  if (!rawJson) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawJson);
  } catch (_error) {
    const error = new Error('HB_PLAN_CATALOG_JSON must be valid JSON.');
    error.status = 500;
    throw error;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const error = new Error('HB_PLAN_CATALOG_JSON must be a JSON object keyed by plan key.');
    error.status = 500;
    throw error;
  }

  return parsed;
}

function createDefaultPlanCatalog(values) {
  return {
    main_trial: normalizePlanDefinition('main_trial', {
      type: 'main',
      mode: 'subscription',
      label: 'Max Support Trial',
      priceId: values.stripeMainTrialPriceId,
      stageId: values.stageMaxSupportTrialId,
      amount: 29.99,
      trialPeriodDays: values.trialPeriodDays,
      aliases: ['trial', 'max_support_trial'],
    }),
    gift_1m: normalizePlanDefinition('gift_1m', {
      type: 'gift',
      mode: 'payment',
      label: '1 Month Gift',
      priceId: values.stripeGift1mPriceId,
      stageId: values.stageMaxSupportPayingId,
      amount: 29.99,
      aliases: ['1month', '1m'],
    }),
    gift_3m: normalizePlanDefinition('gift_3m', {
      type: 'gift',
      mode: 'payment',
      label: '3 Month Gift',
      priceId: values.stripeGift3mPriceId,
      stageId: values.stageThreeMonthPassId,
      amount: 79.99,
      aliases: ['3months', '3m'],
    }),
    gift_6m: normalizePlanDefinition('gift_6m', {
      type: 'gift',
      mode: 'payment',
      label: '6 Month Gift',
      priceId: values.stripeGift6mPriceId,
      stageId: values.stageSixMonthPassId || values.stageThreeMonthPassId,
      amount: 139.99,
      aliases: ['6months', '6m'],
    }),
  };
}

function buildPlanCatalog(values, rawCatalogJson) {
  const baseCatalog = createDefaultPlanCatalog(values);
  const overrides = parsePlanCatalogJson(rawCatalogJson);
  if (!overrides) {
    return baseCatalog;
  }

  const merged = { ...baseCatalog };
  Object.entries(overrides).forEach(([key, rawPlan]) => {
    const fallback = merged[key] || {};
    merged[key] = normalizePlanDefinition(key, rawPlan || {}, fallback);
  });

  return merged;
}

export function getConfig(env, request) {
  const requestUrl = new URL(request.url);
  const publicBaseOrigin = normalizeOrigin(readEnv(env, 'PUBLIC_BASE_URL'));
  const origin = publicBaseOrigin || requestUrl.origin;
  const trialPeriodDays = toPositiveInteger(readEnv(env, 'TRIAL_PERIOD_DAYS'), Number(DEFAULTS.TRIAL_PERIOD_DAYS));
  const maxJsonBodyBytes = toPositiveInteger(readEnv(env, 'MAX_JSON_BODY_BYTES'), Number(DEFAULTS.MAX_JSON_BODY_BYTES));
  const rateLimitWindowSeconds = toPositiveInteger(
    readEnv(env, 'RATE_LIMIT_WINDOW_SECONDS'),
    Number(DEFAULTS.RATE_LIMIT_WINDOW_SECONDS),
  );
  const rateLimitMaxRequests = toPositiveInteger(
    readEnv(env, 'RATE_LIMIT_MAX_REQUESTS'),
    Number(DEFAULTS.RATE_LIMIT_MAX_REQUESTS),
  );
  const allowedOrigins = uniqueStrings([
    ...parseCsvOrigins(readEnv(env, 'ALLOWED_ORIGINS')),
    publicBaseOrigin,
    requestUrl.origin,
  ]);
  const requireOriginHeader = toBoolean(readEnv(env, 'REQUIRE_ORIGIN_HEADER'), false);

  const turnstileSiteKey = readEnv(env, 'TURNSTILE_SITE_KEY');
  const turnstileSecretKey = readEnv(env, 'TURNSTILE_SECRET_KEY');
  const turnstileEnforcementRaw = cleanText(readEnv(env, 'TURNSTILE_ENFORCEMENT')).toLowerCase();
  const defaultTurnstileEnforcement = turnstileSecretKey && turnstileSiteKey ? 'required' : 'off';
  const turnstileEnforcement = ['off', 'optional', 'required'].includes(turnstileEnforcementRaw)
    ? turnstileEnforcementRaw
    : defaultTurnstileEnforcement;

  const baseValues = {
    stripeMainTrialPriceId: readEnv(env, 'STRIPE_MAIN_TRIAL_PRICE_ID'),
    stripeGift1mPriceId: readEnv(env, 'STRIPE_GIFT_1M_PRICE_ID'),
    stripeGift3mPriceId: readEnv(env, 'STRIPE_GIFT_3M_PRICE_ID'),
    stripeGift6mPriceId: readEnv(env, 'STRIPE_GIFT_6M_PRICE_ID'),
    stageMaxSupportTrialId: readEnv(env, 'GHL_STAGE_MAX_SUPPORT_TRIAL_ID'),
    stageMaxSupportPayingId: readEnv(env, 'GHL_STAGE_MAX_SUPPORT_PAYING_ID'),
    stageThreeMonthPassId: readEnv(env, 'GHL_STAGE_THREE_MONTH_PASS_ID'),
    stageSixMonthPassId: readEnv(env, 'GHL_STAGE_SIX_MONTH_PASS_ID'),
    trialPeriodDays,
  };

  const planCatalog = buildPlanCatalog(baseValues, readEnv(env, 'HB_PLAN_CATALOG_JSON'));

  return {
    ghlApiBase: readEnv(env, 'GHL_API_BASE'),
    stripeApiBase: readEnv(env, 'STRIPE_API_BASE'),
    stripePublishableKey: readEnv(env, 'STRIPE_PUBLISHABLE_KEY'),
    turnstileSiteKey,
    turnstileSecretKey,
    turnstileEnforcement,

    maxJsonBodyBytes,
    rateLimitWindowSeconds,
    rateLimitMaxRequests,
    allowedOrigins,
    requireOriginHeader,
    healthStatusKey: readEnv(env, 'HEALTH_STATUS_KEY'),
    ghlPrivateToken: readEnv(env, 'GHL_PRIVATE_TOKEN'),
    stripeSecretKey: readEnv(env, 'STRIPE_SECRET_KEY'),
    stripeWebhookSecret: readEnv(env, 'STRIPE_WEBHOOK_SECRET'),

    locationId: readEnv(env, 'GHL_LOCATION_ID'),
    pipelineId: readEnv(env, 'GHL_PIPELINE_ID'),

    stageAbandonedCartId: readEnv(env, 'GHL_STAGE_ABANDONED_CART_ID'),
    stageAbandonedCartGiftingId: readEnv(env, 'GHL_STAGE_ABANDONED_CART_GIFTING_ID'),
    stageMaxSupportTrialId: readEnv(env, 'GHL_STAGE_MAX_SUPPORT_TRIAL_ID'),
    stageMaxSupportPayingId: readEnv(env, 'GHL_STAGE_MAX_SUPPORT_PAYING_ID'),
    stageThreeMonthPassId: readEnv(env, 'GHL_STAGE_THREE_MONTH_PASS_ID'),
    stageSixMonthPassId: readEnv(env, 'GHL_STAGE_SIX_MONTH_PASS_ID'),

    stripeMainTrialPriceId: readEnv(env, 'STRIPE_MAIN_TRIAL_PRICE_ID'),
    stripeGift1mPriceId: readEnv(env, 'STRIPE_GIFT_1M_PRICE_ID'),
    stripeGift3mPriceId: readEnv(env, 'STRIPE_GIFT_3M_PRICE_ID'),
    stripeGift6mPriceId: readEnv(env, 'STRIPE_GIFT_6M_PRICE_ID'),

    trialPeriodDays,
    planCatalog,

    giftContactAssociationKey: readEnv(env, 'GHL_GIFT_CONTACT_ASSOCIATION_KEY'),

    contactRecipientNameFieldId: readEnv(env, 'GHL_CF_CONTACT_HB_RECIPIENT_NAME'),
    contactRecipientPhoneFieldId: readEnv(env, 'GHL_CF_CONTACT_HB_RECIPIENT_PHONE'),
    contactRecipientEmailFieldId: readEnv(env, 'GHL_CF_CONTACT_HB_RECIPIENT_EMAIL'),

    oppGiftingFlagFieldId: readEnv(env, 'GHL_CF_OPP_GIFTING_FLAG'),
    oppRecipientNameFieldId: readEnv(env, 'GHL_CF_OPP_RECIPIENT_NAME'),
    oppRecipientEmailFieldId: readEnv(env, 'GHL_CF_OPP_RECIPIENT_EMAIL'),
    oppRecipientPhoneFieldId: readEnv(env, 'GHL_CF_OPP_RECIPIENT_PHONE'),
    oppGifterNameFieldId: readEnv(env, 'GHL_CF_OPP_GIFTER_NAME'),
    oppGifterEmailFieldId: readEnv(env, 'GHL_CF_OPP_GIFTER_EMAIL'),
    oppWasGiftedFieldId: readEnv(env, 'GHL_CF_OPP_WAS_GIFTED'),

    mainSuccessUrl: readEnv(env, 'MAIN_SUCCESS_URL') || `${origin}/thankyou.html?flow=main&session_id={CHECKOUT_SESSION_ID}`,
    mainCancelUrl: readEnv(env, 'MAIN_CANCEL_URL') || `${origin}/maxsupport.html?checkout=cancelled`,
    giftSuccessUrl: readEnv(env, 'GIFT_SUCCESS_URL') || `${origin}/thankyou.html?gift=true&session_id={CHECKOUT_SESSION_ID}`,
    giftCancelUrl: readEnv(env, 'GIFT_CANCEL_URL') || `${origin}/giftahabitbuddy.html?checkout=cancelled`,
  };
}

export function assertConfig(config, keys) {
  const missing = keys.filter((key) => !config[key]);
  if (missing.length > 0) {
    const error = new Error(`Missing required environment variables: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }
}

export function buildOpportunityName(primaryName, secondaryName) {
  const a = (primaryName || '').trim();
  const b = (secondaryName || '').trim();
  if (a && b) return `${a} - ${b}`;
  return a || b || 'HabitBuddy Lead';
}
