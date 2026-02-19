import { createGiftCheckoutSessionForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
    const result = await createGiftCheckoutSessionForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      checkoutUrl: result.session.url,
      sessionId: result.session.id,
      contactId: result.captured.gifterContact.id,
      opportunityId: result.captured.opportunity.id,
      giftDuration: result.captured.giftPlan.key,
      giftPriceId: result.captured.giftPlan.priceId,
    });
  } catch (error) {
    const parsed = unwrapError(error);
    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestOptions() {
  return optionsResponse();
}
