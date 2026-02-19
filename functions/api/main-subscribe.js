import { activateMainSubscriptionFromSetupIntent } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
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
    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
