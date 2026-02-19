import { jsonResponse, optionsResponse } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';

export async function onRequestGet(context) {
  const config = getConfig(context.env, context.request);
  return jsonResponse({
    success: true,
    service: 'habitbuddy-bridge',
    timestamp: new Date().toISOString(),
    checks: {
      ghlTokenConfigured: Boolean(config.ghlPrivateToken),
      stripeSecretConfigured: Boolean(config.stripeSecretKey),
      stripeWebhookSecretConfigured: Boolean(config.stripeWebhookSecret),
    },
  });
}

export async function onRequestOptions() {
  return optionsResponse();
}
