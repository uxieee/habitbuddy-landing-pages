import { activateMainSubscriptionFromSetupIntent } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';
import { applyApiSecurity } from '../_lib/security.js';

export async function onRequestPost(context) {
  try {
    const securityError = await applyApiSecurity(context, { routeKey: '/api/main-subscribe' });
    if (securityError) return securityError;

    const config = getConfig(context.env, context.request);
    const payload = await readJson(context.request, { maxBytes: config.maxJsonBodyBytes });
    const result = await activateMainSubscriptionFromSetupIntent(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      subscriptionId: result.subscriptionId,
      status: result.status,
      planKey: result.planKey,
      contactId: result.contactId,
      opportunityId: result.opportunityId,
    });
  } catch (error) {
    const parsed = unwrapError(error);
    return errorResponse(parsed.status, parsed.message);
  }
}

export async function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
