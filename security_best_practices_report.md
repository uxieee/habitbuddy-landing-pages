# Security QA Report: Habit Buddy Landing Pages

Date: 2026-02-19
Repository: `/Users/uxie/Documents/Vibe Code/Habit Buddy/landing-pages`

## Executive Summary

This review covered the browser pages and Cloudflare Pages Functions API handlers used for lead capture and Stripe-based checkout/subscription flows.

Top risks are concentrated in public write endpoints and payment finalization logic:

- **High:** no abuse controls (no rate limiting/CAPTCHA/origin hardening) on endpoints that create Stripe/GHL resources.
- **High:** `main-subscribe` is not idempotent and can create duplicate subscriptions on retries/replays.
- **Medium:** `planKey` in `main-subscribe` is client-overridable, enabling plan tampering when multiple plans exist.

A positive control is present: Stripe webhook signature verification is implemented with HMAC and timestamp tolerance.

---

## Findings

### High Severity

### SEC-001: Public write endpoints lack abuse controls (automation/fraud/spam risk)
- **Rule IDs:** EXPRESS-INPUT-001, baseline abuse controls
- **Location:**
  - `functions/api/main-payment-element-init.js:4`
  - `functions/api/main-subscribe.js:4`
  - `functions/api/gift-payment-element-init.js:4`
  - `functions/api/gift-payment-complete.js:4`
  - `functions/_lib/http.js:22`
- **Evidence:** Handlers accept unauthenticated JSON and execute sensitive side effects (Stripe + GHL writes) without anti-automation controls; `readJson()` does not enforce content type or payload size limits.
- **Impact:** Attackers/bots can script high-volume calls to create Stripe objects and CRM records, causing cost, quota exhaustion, and operational noise.
- **Fix:** Add layered controls:
  1. Cloudflare Turnstile token verification on all write endpoints.
  2. IP- and token-based rate limiting at edge (Cloudflare Rules/Workers KV/DO).
  3. Enforce `Content-Type: application/json`, reject oversized bodies, and optionally validate `Origin`/`Referer` for browser traffic.
  4. Add server-side idempotency keys for mutation endpoints.

### SEC-002: `main-subscribe` is replayable and can create duplicate subscriptions
- **Rule IDs:** payment integrity / idempotency
- **Location:**
  - `functions/_lib/habitbuddy.js:687`
  - `functions/_lib/habitbuddy.js:720`
  - `functions/api/main-subscribe.js:7`
- **Evidence:** For a succeeded SetupIntent, the code unconditionally calls `createSubscription(...)` with no dedupe check, event lock, or idempotency key.
- **Impact:** Network retries or deliberate replay can create multiple active subscriptions and duplicate billing.
- **Fix:**
  1. Persist a one-time “processed SetupIntent ID” lock before subscription creation.
  2. Supply Stripe idempotency key tied to SetupIntent ID.
  3. Check for existing subscription linkage in metadata/storage before creating a new one.

### Medium Severity

### SEC-003: Client can override subscription plan at activation time
- **Rule IDs:** input-to-sensitive-action authorization
- **Location:** `functions/_lib/habitbuddy.js:701`
- **Evidence:** `resolveMainPlan(config, payload.plan_key || payload.planKey || metadata.planKey || MAIN_TRIAL_PLAN_KEY)` prioritizes client payload over Stripe metadata.
- **Impact:** If multiple plans exist, clients can tamper with `planKey` and force unintended pricing/trial behavior.
- **Fix:** Trust only server-generated/Stripe metadata for final plan selection (or signed server token), not client payload.
- **Note:** Current impact may be limited if only one main plan is configured.

### SEC-004: Upstream error details are returned to public clients
- **Rule IDs:** error handling / information disclosure
- **Location:**
  - `functions/_lib/http.js:11`
  - `functions/_lib/http.js:56`
  - `functions/api/main-subscribe.js:19`
  - `functions/api/gift-payment-complete.js:20`
  - `functions/api/main-payment-element-init.js:21`
- **Evidence:** API responses include `details` from `error.details || error.data` (Stripe/GHL upstream payloads).
- **Impact:** Internal identifiers, integration behavior, and request diagnostics may leak to attackers and aid reconnaissance.
- **Fix:** Return sanitized public errors; keep full provider details only in server logs with redaction.

### SEC-005: Input validation is minimal for user-controlled fields
- **Rule IDs:** EXPRESS-INPUT-001
- **Location:**
  - `functions/_lib/habitbuddy.js:233`
  - `functions/_lib/habitbuddy.js:256`
- **Evidence:** Validation primarily checks presence, with limited format/bounds checks (e.g., no strict email validation, no max lengths for names/messages).
- **Impact:** Increases risk of data poisoning, abuse payloads, and downstream rendering issues in integrated systems.
- **Fix:** Add schema validation (Zod/Joi) with explicit type/length/format constraints and normalization for all request bodies.

### Low Severity

### SEC-006: Health endpoint discloses security posture metadata
- **Rule IDs:** information disclosure (recon)
- **Location:** `functions/api/health.js:10`
- **Evidence:** Public endpoint reveals whether Stripe/GHL secrets are configured.
- **Impact:** Helps attackers profile environment readiness and integration stack.
- **Fix:** Restrict health endpoint (auth/IP allowlist) or return minimal liveness only.

### SEC-007: No explicit CSP/security headers visible in app code
- **Rule IDs:** JS frontend secure baseline (CSP/headers)
- **Location:**
  - `index.html:11`
  - `maxsupport.html:11`
  - `giftahabitbuddy.html:11`
- **Evidence:** No CSP or related security headers are configured in repository code; pages run inline scripts and third-party scripts.
- **Impact:** Raises blast radius if any XSS is introduced later.
- **Fix:** Configure CSP and security headers at Cloudflare edge (or early meta CSP if headers unavailable), then tighten over time.

---

## Positive Controls Observed

- Stripe webhook signature verification appears correctly implemented with:
  - HMAC-SHA256 computation and timing-safe comparison (`functions/_lib/stripe.js:166`)
  - Timestamp tolerance check (`functions/_lib/stripe.js:177`)
  - Signature enforcement before event processing (`functions/api/stripe-webhook.js:101`)

---

## Recommended Remediation Order

1. Fix replay/idempotency in `main-subscribe`.
2. Add anti-abuse controls (Turnstile + rate limiting + content-type/size checks).
3. Remove client plan override; bind final plan to server metadata only.
4. Sanitize public error responses.
5. Add strict schema validation and input constraints.
6. Lock down health endpoint and add CSP/security headers.
