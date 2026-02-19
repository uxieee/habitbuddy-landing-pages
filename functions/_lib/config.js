const DEFAULTS = {
  GHL_API_BASE: 'https://services.leadconnectorhq.com',
  STRIPE_API_BASE: 'https://api.stripe.com/v1',

  GHL_LOCATION_ID: '3ouY0YkB0fLDFs5nb8UG',
  GHL_PIPELINE_ID: 'fQzLboVKi639klKBI64N',

  GHL_STAGE_ABANDONED_CART_ID: 'c2e2a8b3-c24c-4aaa-b1a2-7c4a7058fad7',
  GHL_STAGE_ABANDONED_CART_GIFTING_ID: '0c44c2e9-bd2f-4268-9b4d-b0e7fd2310f3',
  GHL_STAGE_MAX_SUPPORT_TRIAL_ID: '29d60203-9e41-4678-80db-4b96b9c17fbf',
  GHL_STAGE_MAX_SUPPORT_PAYING_ID: '7715d018-dcba-4037-b261-aa0f7ffeba83',
  GHL_STAGE_THREE_MONTH_PASS_ID: '62071a34-2e22-41a6-8fcb-450ea698f29e',

  STRIPE_MAIN_TRIAL_PRICE_ID: 'price_1SafOpAuSIQTND927csHvIkZ',
  STRIPE_GIFT_1M_PRICE_ID: 'price_1T2SYFAuSIQTND92WVcZHe6r',
  STRIPE_GIFT_3M_PRICE_ID: 'price_1T2SZfAuSIQTND9285U7Fxey',
  STRIPE_GIFT_6M_PRICE_ID: '',

  TRIAL_PERIOD_DAYS: '7',

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

export function getConfig(env, request) {
  const requestUrl = new URL(request.url);
  const origin = readEnv(env, 'PUBLIC_BASE_URL') || requestUrl.origin;

  return {
    ghlApiBase: readEnv(env, 'GHL_API_BASE'),
    stripeApiBase: readEnv(env, 'STRIPE_API_BASE'),
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

    stripeMainTrialPriceId: readEnv(env, 'STRIPE_MAIN_TRIAL_PRICE_ID'),
    stripeGift1mPriceId: readEnv(env, 'STRIPE_GIFT_1M_PRICE_ID'),
    stripeGift3mPriceId: readEnv(env, 'STRIPE_GIFT_3M_PRICE_ID'),
    stripeGift6mPriceId: readEnv(env, 'STRIPE_GIFT_6M_PRICE_ID'),

    trialPeriodDays: Number(readEnv(env, 'TRIAL_PERIOD_DAYS') || DEFAULTS.TRIAL_PERIOD_DAYS),

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
