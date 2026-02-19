import { createGiftCheckoutSessionForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';
import { applyApiSecurity } from '../_lib/security.js';

export async function onRequestPost(context) {
  try {
    const securityError = await applyApiSecurity(context, { routeKey: '/api/gift-checkout-session' });
    if (securityError) return securityError;

    const config = getConfig(context.env, context.request);
    const payload = await readJson(context.request, { maxBytes: config.maxJsonBodyBytes });
    const result = await createGiftCheckoutSessionForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      checkoutUrl: result.session.url,
      sessionId: result.session.id,
      contactId: result.captured.gifterContact.id,
      opportunityId: result.captured.opportunity.id,
      planKey: result.captured.giftPlan.key,
      giftDuration: result.captured.giftPlan.key,
      giftPriceId: result.captured.giftPlan.priceId,
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
