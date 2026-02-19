import { finalizeGiftPaymentIntent } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
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
    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
