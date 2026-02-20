import { createMainSetupIntentForLead } from '../_lib/habitbuddy.js';
import { readJson, jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';
import { getConfig } from '../_lib/config.js';
import { applyApiSecurity } from '../_lib/security.js';

export async function onRequestPost(context) {
  try {
    const securityError = await applyApiSecurity(context, {
      routeKey: '/api/main-payment-element-init',
      turnstileAction: 'main_payment_init',
    });
    if (securityError) return securityError;

    const config = getConfig(context.env, context.request);
    const payload = await readJson(context.request, { maxBytes: config.maxJsonBodyBytes });
    const result = await createMainSetupIntentForLead(context.env, context.request, payload);

    return jsonResponse({
      success: true,
      publishableKey: result.publishableKey,
      clientSecret: result.setupIntent.client_secret,
      setupIntentId: result.setupIntent.id,
      customerId: result.customerId,
      contactId: result.captured.contact.id,
      opportunityId: result.captured.opportunity.id,
      planKey: result.plan.key,
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
