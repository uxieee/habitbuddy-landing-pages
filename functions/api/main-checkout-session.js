import { createMainCheckoutSessionForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';
import { applyApiSecurity } from '../_lib/security.js';

export async function onRequestPost(context) {
  try {
    const securityError = await applyApiSecurity(context, { routeKey: '/api/main-checkout-session' });
    if (securityError) return securityError;

    const config = getConfig(context.env, context.request);
    const payload = await readJson(context.request, { maxBytes: config.maxJsonBodyBytes });
    const result = await createMainCheckoutSessionForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      checkoutUrl: result.session.url,
      sessionId: result.session.id,
      planKey: result.captured.mainPlan?.key || 'main_trial',
      contactId: result.captured.contact.id,
      opportunityId: result.captured.opportunity.id,
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
