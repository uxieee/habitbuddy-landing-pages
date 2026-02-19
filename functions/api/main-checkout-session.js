import { createMainCheckoutSessionForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
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
    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
