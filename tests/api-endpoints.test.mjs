import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as onSecurityConfigGet } from '../functions/api/security-config.js';
import { onRequestPost as onMainPaymentInitPost } from '../functions/api/main-payment-element-init.js';
import { onRequestGet as onMainLeadGet } from '../functions/api/main-lead.js';
import { onRequestGet as onGiftLeadGet } from '../functions/api/gift-lead.js';

function createContext(pathname, { method = 'GET', headers = {}, body, env = {} } = {}) {
  const request = new Request(`https://example.com${pathname}`, {
    method,
    headers,
    body,
  });
  return { request, env };
}

async function readJson(response) {
  return response.json();
}

test('GET /api/security-config returns public security config', async () => {
  const response = await onSecurityConfigGet(createContext('/api/security-config'));
  assert.equal(response.status, 200);
  const body = await readJson(response);
  assert.equal(body.success, true);
  assert.equal(typeof body.turnstileEnabled, 'boolean');
  assert.equal(typeof body.turnstileMode, 'string');
});

test('POST /api/main-payment-element-init blocks disallowed origin before upstream calls', async () => {
  const payload = {
    first_name: 'QA',
    phone: '+19166868518',
    habit_focus: 'exercise',
    checkin_time: '8am',
  };

  const response = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    }),
  );

  assert.equal(response.status, 403);
  const body = await readJson(response);
  assert.equal(body.success, false);
  assert.equal(body.error, 'Origin is not allowed.');
});

test('POST /api/main-payment-element-init rejects oversized JSON body', async () => {
  const largePayload = JSON.stringify({ blob: 'x'.repeat(33000) });
  const response = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/json',
      },
      body: largePayload,
      env: {
        ALLOWED_ORIGINS: 'https://example.com',
      },
    }),
  );

  assert.equal(response.status, 413);
  const body = await readJson(response);
  assert.equal(body.error, 'Request body is too large.');
});

test('POST /api/main-payment-element-init enforces rate limit before business logic', async () => {
  const env = {
    ALLOWED_ORIGINS: 'https://example.com',
    RATE_LIMIT_MAX_REQUESTS: '2',
    RATE_LIMIT_WINDOW_SECONDS: '60',
  };
  const headers = {
    origin: 'https://example.com',
    'content-type': 'application/json',
    'CF-Connecting-IP': '203.0.113.77',
  };
  const body = JSON.stringify({
    first_name: 'QA',
    phone: '+19166868518',
    habit_focus: 'exercise',
    checkin_time: '8am',
  });

  const first = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', { method: 'POST', headers, body, env }),
  );
  const second = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', { method: 'POST', headers, body, env }),
  );
  const third = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', { method: 'POST', headers, body, env }),
  );

  assert.equal(first.status, 500);
  assert.equal(second.status, 500);
  assert.equal(third.status, 429);
  assert.equal(third.headers.get('Retry-After') !== null, true);
});

test('POST /api/main-payment-element-init requires first name, last name, email, and phone before upstream calls', async (t) => {
  const env = {
    ALLOWED_ORIGINS: 'https://example.com',
    STRIPE_SECRET_KEY: 'sk_test_local',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_local',
    STRIPE_MAIN_TRIAL_PRICE_ID: 'price_test_123',
    GHL_PRIVATE_TOKEN: 'ghl_test_token',
  };

  const originalFetch = globalThis.fetch;
  const upstreamCalls = [];
  globalThis.fetch = async (...args) => {
    upstreamCalls.push(args);
    throw new Error('Unexpected upstream call.');
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const missingLastName = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        first_name: 'QA',
        email: 'qa@example.com',
        phone: '+19166868518',
        habit_focus: 'exercise',
        checkin_time: '8am',
      }),
      env,
    }),
  );
  assert.equal(missingLastName.status, 400);
  assert.equal((await readJson(missingLastName)).error, 'Last name is required.');
  assert.equal(upstreamCalls.length, 0);

  const missingEmail = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        first_name: 'QA',
        last_name: 'Tester',
        phone: '+19166868518',
        habit_focus: 'exercise',
        checkin_time: '8am',
      }),
      env,
    }),
  );
  assert.equal(missingEmail.status, 400);
  assert.equal((await readJson(missingEmail)).error, 'Email is required.');
  assert.equal(upstreamCalls.length, 0);

  const missingPhone = await onMainPaymentInitPost(
    createContext('/api/main-payment-element-init', {
      method: 'POST',
      headers: {
        origin: 'https://example.com',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        first_name: 'QA',
        last_name: 'Tester',
        email: 'qa@example.com',
        habit_focus: 'exercise',
        checkin_time: '8am',
      }),
      env,
    }),
  );
  assert.equal(missingPhone.status, 400);
  assert.equal((await readJson(missingPhone)).error, 'Phone number is required.');
  assert.equal(upstreamCalls.length, 0);
});

test('retired lead endpoints return 410 with migration guidance', async () => {
  const [mainResponse, giftResponse] = await Promise.all([
    onMainLeadGet(createContext('/api/main-lead')),
    onGiftLeadGet(createContext('/api/gift-lead')),
  ]);

  assert.equal(mainResponse.status, 410);
  assert.equal(giftResponse.status, 410);

  const mainBody = await readJson(mainResponse);
  const giftBody = await readJson(giftResponse);
  assert.match(mainBody.error, /Endpoint retired/);
  assert.match(giftBody.error, /Endpoint retired/);
});
