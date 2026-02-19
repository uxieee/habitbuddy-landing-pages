import { getConfig } from '../_lib/config.js';
import { jsonResponse, methodNotAllowed, optionsResponse } from '../_lib/http.js';

export async function onRequestGet(context) {
  const config = getConfig(context.env, context.request);
  const turnstileEnabled =
    Boolean(config.turnstileSiteKey) &&
    Boolean(config.turnstileSecretKey) &&
    config.turnstileEnforcement !== 'off';

  return jsonResponse({
    success: true,
    turnstileEnabled,
    turnstileMode: config.turnstileEnforcement,
    turnstileSiteKey: turnstileEnabled ? config.turnstileSiteKey : '',
  });
}

export async function onRequestPost() {
  return methodNotAllowed(['GET']);
}

export async function onRequestOptions() {
  return optionsResponse(['GET', 'OPTIONS']);
}
