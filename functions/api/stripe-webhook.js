import { verifyStripeWebhookSignature } from '../_lib/stripe.js';
import { processMainCheckoutCompleted, processGiftCheckoutCompleted } from '../_lib/habitbuddy.js';
import { getConfig, assertConfig } from '../_lib/config.js';
import { jsonResponse, errorResponse, methodNotAllowed, optionsResponse, unwrapError } from '../_lib/http.js';

function parseEvent(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch (_error) {
    const error = new Error('Invalid Stripe webhook payload.');
    error.status = 400;
    throw error;
  }
}

async function handleCheckoutEvent(env, event) {
  const session = event?.data?.object;
  if (!session || typeof session !== 'object') {
    return { skipped: true, reason: 'missing-session' };
  }

  const flow = String(session?.metadata?.flow || '').toLowerCase();

  if (flow === 'main_trial') {
    const result = await processMainCheckoutCompleted(env, session);
    return { flow, ...result };
  }

  if (flow === 'gift_purchase') {
    const result = await processGiftCheckoutCompleted(env, session);
    return { flow, ...result };
  }

  return { skipped: true, reason: 'unknown-flow', flow };
}

function subscriptionToSessionLike(subscription) {
  return {
    metadata: subscription?.metadata || {},
    customer_email: undefined,
    customer_details: {},
  };
}

function paymentIntentToSessionLike(paymentIntent) {
  const metadata = paymentIntent?.metadata || {};
  const charge = paymentIntent?.latest_charge || {};
  const billing = charge?.billing_details || {};
  return {
    metadata,
    customer_email: billing.email || metadata.senderEmail || metadata.sender_email || undefined,
    customer_details: {
      email: billing.email || metadata.senderEmail || metadata.sender_email || undefined,
      phone: billing.phone || metadata.recipientPhone || metadata.recipient_phone || undefined,
      name: billing.name || metadata.senderName || metadata.sender_name || undefined,
    },
  };
}

async function handleSubscriptionEvent(env, event) {
  const subscription = event?.data?.object;
  if (!subscription || typeof subscription !== 'object') {
    return { skipped: true, reason: 'missing-subscription' };
  }

  const flow = String(subscription?.metadata?.flow || '').toLowerCase();
  if (flow !== 'main_trial') {
    return { skipped: true, reason: 'unknown-flow', flow };
  }

  const result = await processMainCheckoutCompleted(env, subscriptionToSessionLike(subscription));
  return { flow, ...result };
}

async function handlePaymentIntentEvent(env, event) {
  const paymentIntent = event?.data?.object;
  if (!paymentIntent || typeof paymentIntent !== 'object') {
    return { skipped: true, reason: 'missing-payment-intent' };
  }

  const flow = String(paymentIntent?.metadata?.flow || '').toLowerCase();
  if (flow !== 'gift_purchase') {
    return { skipped: true, reason: 'unknown-flow', flow };
  }

  const result = await processGiftCheckoutCompleted(env, paymentIntentToSessionLike(paymentIntent));
  return { flow, ...result };
}

export async function onRequestPost(context) {
  try {
    const config = getConfig(context.env, context.request);
    assertConfig(config, ['stripeWebhookSecret', 'ghlPrivateToken', 'locationId', 'pipelineId']);

    const signature = context.request.headers.get('stripe-signature');
    const rawBody = await context.request.text();

    const isValid = await verifyStripeWebhookSignature(rawBody, signature, config.stripeWebhookSecret);
    if (!isValid) {
      return errorResponse(400, 'Invalid Stripe signature.');
    }

    const event = parseEvent(rawBody);
    const type = String(event?.type || '');

    let result = { skipped: true, reason: 'unsupported-event' };

    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      result = await handleCheckoutEvent(context.env, event);
    } else if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      result = await handleSubscriptionEvent(context.env, event);
    } else if (type === 'payment_intent.succeeded') {
      result = await handlePaymentIntentEvent(context.env, event);
    }

    return jsonResponse({
      success: true,
      received: true,
      eventId: event?.id,
      eventType: type,
      result,
    });
  } catch (error) {
    const parsed = unwrapError(error);
    console.error('Stripe webhook failure:', parsed.message, parsed.details || '');

    // Return 200 for transient business logic failures to avoid repeated hard loops.
    if (parsed.status >= 400 && parsed.status < 500) {
      return jsonResponse({
        success: false,
        received: true,
        ignored: true,
        error: parsed.message,
      });
    }

    return errorResponse(parsed.status, parsed.message, parsed.details);
  }
}

export async function onRequestGet() {
  return methodNotAllowed(['POST']);
}

export async function onRequestOptions() {
  return optionsResponse(['POST', 'OPTIONS']);
}
