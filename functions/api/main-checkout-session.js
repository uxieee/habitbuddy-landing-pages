import { createMainCheckoutSessionForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
    const result = await createMainCheckoutSessionForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      checkoutUrl: result.session.url,
      sessionId: result.session.id,
      contactId: result.captured.contact.id,
      opportunityId: result.captured.opportunity.id,
    });
  } catch (error) {
    const parsed = unwrapError(error);
    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestOptions() {
  return optionsResponse();
}
