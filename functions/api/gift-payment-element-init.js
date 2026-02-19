import { createGiftPaymentIntentForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
    const result = await createGiftPaymentIntentForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      publishableKey: result.publishableKey,
      clientSecret: result.paymentIntent.client_secret,
      paymentIntentId: result.paymentIntent.id,
      contactId: result.captured.gifterContact.id,
      opportunityId: result.captured.opportunity.id,
      planKey: result.plan.key,
      giftPriceId: result.plan.priceId,
      amount: result.plan.amount,
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
