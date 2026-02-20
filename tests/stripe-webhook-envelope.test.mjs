import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as onStripeWebhookPost } from '../functions/api/stripe-webhook.js';

function createContext({ method = 'POST', headers = {}, body = '', env = {} } = {}) {
  const request = new Request('https://example.com/api/stripe-webhook', {
    method,
    headers,
    body,
  });
  return { request, env };
}

async function readJson(response) {
  return response.json();
}

async function signStripePayload(rawBody, signingSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const signatureHex = Buffer.from(signatureBuffer).toString('hex');
  return `t=${timestamp},v1=${signatureHex}`;
}

test('oversized webhook payload is rejected with 413 before config assertion', async () => {
  const oversizedBody = JSON.stringify({
    id: 'evt_oversized',
    type: 'checkout.session.completed',
    data: { object: { metadata: { flow: 'main_trial' } } },
    pad: 'x'.repeat(300000),
  });

  const response = await onStripeWebhookPost(
    createContext({
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
      body: oversizedBody,
    }),
  );

  assert.equal(response.status, 413);
  const parsed = await readJson(response);
  assert.equal(parsed.error, 'Stripe webhook payload is too large.');
});

test('invalid webhook signature is rejected with 400', async () => {
  const rawBody = JSON.stringify({
    id: 'evt_invalid_sig',
    type: 'payment_intent.succeeded',
    data: { object: { metadata: { flow: 'gift_purchase' } } },
  });

  const response = await onStripeWebhookPost(
    createContext({
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
      body: rawBody,
      env: {
        STRIPE_WEBHOOK_SECRET: 'whsec_test_signature',
        GHL_PRIVATE_TOKEN: 'pit_test_token',
      },
    }),
  );

  assert.equal(response.status, 400);
  const parsed = await readJson(response);
  assert.equal(parsed.error, 'Invalid Stripe signature.');
});

test('unsupported event with valid signature is safely acknowledged', async () => {
  const signingSecret = 'whsec_test_signature';
  const rawBody = JSON.stringify({
    id: 'evt_unsupported',
    type: 'customer.created',
    data: { object: { id: 'cus_123' } },
  });
  const stripeSignature = await signStripePayload(rawBody, signingSecret);

  const response = await onStripeWebhookPost(
    createContext({
      headers: {
        'content-type': 'application/json',
        'stripe-signature': stripeSignature,
      },
      body: rawBody,
      env: {
        STRIPE_WEBHOOK_SECRET: signingSecret,
        GHL_PRIVATE_TOKEN: 'pit_test_token',
      },
    }),
  );

  assert.equal(response.status, 200);
  const parsed = await readJson(response);
  assert.equal(parsed.success, true);
  assert.equal(parsed.received, true);
  assert.equal(parsed.eventType, 'customer.created');
  assert.equal(parsed.result?.reason, 'unsupported-event');
});
