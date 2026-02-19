import { getConfig, assertConfig } from './config.js';

function flatten(value, prefix, out) {
  if (value === undefined || value === null) return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}[${index}]`, out));
    return;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      const nextPrefix = prefix ? `${prefix}[${key}]` : key;
      flatten(child, nextPrefix, out);
    });
    return;
  }

  out.push([prefix, String(value)]);
}

function encodeForm(payload) {
  const pairs = [];
  Object.entries(payload || {}).forEach(([key, value]) => flatten(value, key, pairs));
  const form = new URLSearchParams();
  pairs.forEach(([key, value]) => form.append(key, value));
  return form;
}

function encodeQuery(payload) {
  const pairs = [];
  Object.entries(payload || {}).forEach(([key, value]) => flatten(value, key, pairs));
  const query = new URLSearchParams();
  pairs.forEach(([key, value]) => query.append(key, value));
  return query;
}

async function parseResponse(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

function makeError(status, message, data) {
  const error = new Error(message || 'Stripe request failed.');
  error.status = status;
  error.data = data;
  return error;
}

export async function stripeRequest(env, path, payload = {}) {
  return stripeRawRequest(env, path, { method: 'POST', payload });
}

export async function stripeRawRequest(env, path, options = {}) {
  const config = getConfig(env, { url: 'https://example.com' });
  assertConfig(config, ['stripeSecretKey']);

  const method = options.method || 'POST';
  const headers = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    Accept: 'application/json',
    'User-Agent': 'HabitBuddyBridge/1.0',
    ...(options.headers || {}),
  };
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = String(options.idempotencyKey);
  }

  const query = encodeQuery(options.query || {});
  const url = `${config.stripeApiBase}${path}${query.size ? `?${query.toString()}` : ''}`;

  let body;
  if (method !== 'GET' && method !== 'HEAD' && options.payload !== undefined) {
    body = encodeForm(options.payload);
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
  });

  const data = await parseResponse(res);
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Stripe ${path} failed with ${res.status}`;
    throw makeError(res.status, message, data);
  }

  return data;
}

export async function stripeGet(env, path, query = {}) {
  return stripeRawRequest(env, path, { method: 'GET', query });
}

export async function createCheckoutSession(env, payload) {
  return stripeRequest(env, '/checkout/sessions', payload);
}

export async function createCustomer(env, payload) {
  return stripeRequest(env, '/customers', payload);
}

export async function createSetupIntent(env, payload) {
  return stripeRequest(env, '/setup_intents', payload);
}

export async function retrieveSetupIntent(env, setupIntentId, query = {}) {
  return stripeGet(env, `/setup_intents/${setupIntentId}`, query);
}

export async function createSubscription(env, payload) {
  return stripeRequest(env, '/subscriptions', payload);
}

export async function createSubscriptionWithIdempotency(env, payload, idempotencyKey) {
  return stripeRawRequest(env, '/subscriptions', {
    method: 'POST',
    payload,
    idempotencyKey,
  });
}

export async function createPaymentIntent(env, payload) {
  return stripeRequest(env, '/payment_intents', payload);
}

export async function retrievePaymentIntent(env, paymentIntentId, query = {}) {
  return stripeGet(env, `/payment_intents/${paymentIntentId}`, query);
}

export async function retrievePrice(env, priceId, query = {}) {
  return stripeGet(env, `/prices/${priceId}`, query);
}

export async function listSubscriptions(env, query = {}) {
  return stripeGet(env, '/subscriptions', query);
}

function parseStripeSignatureHeader(headerValue) {
  const result = {
    timestamp: null,
    signatures: [],
  };

  if (!headerValue) return result;

  headerValue.split(',').forEach((part) => {
    const [k, v] = part.trim().split('=', 2);
    if (k === 't') result.timestamp = v;
    if (k === 'v1' && v) result.signatures.push(v);
  });

  return result;
}

function toHex(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function verifyStripeWebhookSignature(rawBody, signatureHeader, signingSecret) {
  if (!signatureHeader || !signingSecret) return false;

  const { timestamp, signatures } = parseStripeSignatureHeader(signatureHeader);
  if (!timestamp || signatures.length === 0) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  // Stripe recommends 5-minute tolerance.
  if (Math.abs(nowSeconds - timestampSeconds) > 300) return false;

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
  const expectedSignature = toHex(signatureBuffer);

  return signatures.some((candidate) => timingSafeEqual(candidate, expectedSignature));
}
