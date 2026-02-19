import { jsonResponse, optionsResponse } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';

export async function onRequestGet(context) {
  const config = getConfig(context.env, context.request);
  const suppliedKey = String(context.request.headers.get('x-health-key') || '');
  const includeChecks = Boolean(config.healthStatusKey) && suppliedKey === config.healthStatusKey;

  return jsonResponse({
    success: true,
    service: 'habitbuddy-bridge',
    timestamp: new Date().toISOString(),
    ...(includeChecks
      ? {
          checks: {
            ghlTokenConfigured: Boolean(config.ghlPrivateToken),
            stripePublishableConfigured: Boolean(config.stripePublishableKey),
            stripeSecretConfigured: Boolean(config.stripeSecretKey),
            stripeWebhookSecretConfigured: Boolean(config.stripeWebhookSecret),
          },
        }
      : {}),
  });
}

export async function onRequestOptions() {
  return optionsResponse(['GET', 'OPTIONS']);
}
