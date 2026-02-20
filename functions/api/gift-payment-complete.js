import { finalizeGiftPaymentIntent } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';
import { applyApiSecurity } from '../_lib/security.js';

export async function onRequestPost(context) {
  try {
    const securityError = await applyApiSecurity(context, {
      routeKey: '/api/gift-payment-complete',
      turnstileAction: 'gift_payment_complete',
    });
    if (securityError) return securityError;

    const config = getConfig(context.env, context.request);
    const payload = await readJson(context.request, { maxBytes: config.maxJsonBodyBytes });
    const result = await finalizeGiftPaymentIntent(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      paymentIntentId: result.paymentIntentId,
      status: result.status,
      gifterContactId: result.gifterContactId,
      recipientContactId: result.recipientContactId,
      opportunityId: result.opportunityId,
      giftPlan: result.giftPlan,
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
