import { captureMainLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

export async function onRequestPost(context) {
  try {
    const payload = await readJson(context.request);
    const result = await captureMainLead(context.env, payload);

    return jsonResponse({
      success: true,
      contactId: result.contact.id,
      opportunityId: result.opportunity.id,
      stageId: result.opportunity.pipelineStageId,
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
