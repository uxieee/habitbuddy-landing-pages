# Security Hardening Runbook

Last updated: 2026-02-20
Repository: `habitbuddy-landing-pages`

> For the unified history + setup + operations guide, use `HABITBUDDY_MASTER_RUNBOOK.md`.

This document explains:
- What security changes were made
- Why they were made
- How they affect site behavior
- What you must configure in Cloudflare
- How to verify production is healthy

---

## 1) Where the security documents live

- Security findings report: `../reports/security_best_practices_report.md`
- This implementation runbook: `SECURITY-HARDENING-RUNBOOK.md`

The findings report is the "what risks were found" document.
This runbook is the "what was changed + what you must do next" document.

---

## 2) Summary of implemented changes

### A) API abuse protection

Implemented a shared API guard at:
- `functions/_lib/security.js`

Guard adds:
- Origin allowlist enforcement
- Optional requirement for `Origin` header
- In-memory per-IP, per-route rate limiting
- Cloudflare Turnstile verification (off/optional/required)
- Turnstile hostname binding and per-endpoint action binding

Applied to write endpoints:
- `functions/api/main-payment-element-init.js`
- `functions/api/main-subscribe.js`
- `functions/api/gift-payment-element-init.js`
- `functions/api/gift-payment-complete.js`

Why:
- Mitigates bot abuse, spam submissions, and scripted payment-flow abuse.

Effect on website:
- Legit browser users continue to work normally.
- Requests from disallowed origins, missing/invalid human verification, or over limit return 4xx.
- Tokens replayed with wrong Turnstile `action`/hostname are rejected.

---

### B) Safer request parsing and response hardening

Updated:
- `functions/_lib/http.js`
- `functions/api/stripe-webhook.js`
- `functions/_lib/config.js`

Changes:
- Enforces `Content-Type: application/json` for JSON endpoints
- Enforces request body size limit
- Enforces Stripe webhook raw body size limit via `MAX_WEBHOOK_BODY_BYTES`
- Rejects invalid/non-object JSON cleanly
- Adds no-store and nosniff style response hardening headers for JSON responses
- Stops returning upstream provider internals to public clients by default

Why:
- Reduces malformed payload abuse and info leakage.

Effect on website:
- API clients must send proper JSON headers.
- Oversized or invalid payloads are rejected earlier.

---

### C) Payment replay and plan tamper protection

Updated:
- `functions/_lib/habitbuddy.js`
- `functions/_lib/stripe.js`

Changes:
- `main-subscribe` now uses Stripe idempotency key based on `setupIntentId`
- Checks for existing subscription linked to same `setupIntentId`
- Detects metadata plan key mismatch vs request plan key
- Stores and reuses setup-intent linkage metadata

Why:
- Prevents duplicate subscriptions from retries/replays
- Reduces client plan-tampering risk during activation

Effect on website:
- Retry-safe subscription activation behavior
- Duplicate activation attempts should no longer create multiple active subscriptions

---

### D) Input validation hardening

Updated:
- `functions/_lib/habitbuddy.js`

Changes:
- Added max-length checks for key text fields
- Added stricter email validation
- Added stricter phone normalization/validation
- Added plan key format validation

Why:
- Reduces bad/abusive input entering downstream systems.

Effect on website:
- Invalid inputs are rejected with user-facing error responses.

---

### E) Health endpoint recon reduction

Updated:
- `functions/api/health.js`

Changes:
- Public health is now minimal by default
- Detailed checks only returned when request includes valid `x-health-key`

Why:
- Prevents anonymous probing of integration readiness.

Effect on website:
- No user-facing impact.

---

### F) Frontend Turnstile integration

Updated:
- `maxsupport.html`
- `giftahabitbuddy.html`
- `functions/api/security-config.js`

Changes:
- Added Turnstile script and invisible widget flow
- Frontend fetches runtime security config from `/api/security-config`
- Sensitive API posts now attach `x-turnstile-token` when enabled

Why:
- Enables strong bot resistance without hardcoding secrets.

Effect on website:
- If Turnstile is enabled, users complete invisible human verification during protected actions.

---

### G) Security headers and CSP

Added:
- `_headers`

Headers include:
- Content-Security-Policy
- X-Content-Type-Options
- X-Frame-Options
- Referrer-Policy
- Permissions-Policy

Why:
- Improves browser-side defense-in-depth against XSS/clickjacking/content-type abuse.

Effect on website:
- Current policy is compatible with Stripe + Turnstile + Vimeo + Google Fonts setup.

---

### H) Minor DOM safety cleanup

Updated:
- `thankyou.html`

Changes:
- Removed `innerHTML` usage where not needed

Why:
- Reduces future DOM-XSS footguns.

Effect on website:
- Same user-visible behavior.

---

### I) Data minimization for gift message

Updated:
- `functions/_lib/habitbuddy.js`
- `giftahabitbuddy.html`

Changes:
- Removed gift message from Stripe metadata payloads
- Writes gift message into GHL opportunity custom field (`GHL_CF_OPP_GIFT_MESSAGE`)
- Added frontend message length cap to match backend validation

Why:
- Avoids storing non-payment content in Stripe metadata and prevents metadata length failures.

Effect on website:
- Gift message still reaches GHL opportunity records, but is no longer sent to Stripe.

---

### J) Legacy endpoint retirement

Updated:
- `functions/api/main-lead.js`
- `functions/api/gift-lead.js`
- `functions/api/main-checkout-session.js`
- `functions/api/gift-checkout-session.js`

Changes:
- Legacy write endpoints now return `410 Gone`.

Why:
- Reduces attack surface by removing unused public mutation paths.

Effect on website:
- No impact on current checkout UX (Payment Element routes remain active).

---

## 3) Required Cloudflare setup (you must do this)

### Step 1: Turnstile

In Cloudflare dashboard:
1. Go to **Turnstile** > **Add site**
2. Create an **Invisible** widget
3. Add domains:
   - Production domain (for example `tryhabitbuddy.com`)
   - Pages preview domain (for example `*.pages.dev`)
4. Copy site key and secret key

### Step 2: Pages environment variables

In Cloudflare Pages project:
1. Go to **Settings** > **Variables and Secrets**
2. Add these values (Production and Preview where needed):

Required for this hardening to be active:
- `TURNSTILE_SITE_KEY=<from Turnstile>`
- `TURNSTILE_SECRET_KEY=<from Turnstile>`
- `TURNSTILE_ENFORCEMENT=required`
- `ALLOWED_ORIGINS=https://tryhabitbuddy.com,https://<your-project>.pages.dev`
- `REQUIRE_ORIGIN_HEADER=true`
- `MAX_JSON_BODY_BYTES=32768`
- `MAX_WEBHOOK_BODY_BYTES=262144`
- `RATE_LIMIT_WINDOW_SECONDS=60`
- `RATE_LIMIT_MAX_REQUESTS=30`
- `HEALTH_STATUS_KEY=<random-long-secret>`
- `GHL_CF_OPP_GIFT_MESSAGE=<your-opportunity-custom-field-id>`

Also keep existing production vars set:
- Stripe keys and webhook secret
- Stripe price IDs, including 6-month gift price IDs (`STRIPE_GIFT_6M_PRICE_ID_TEST` and `STRIPE_GIFT_6M_PRICE_ID_LIVE`)
- GHL token and IDs

### Step 3: Deploy

- Push to `main` (already done for the hardening commit)
- Confirm Pages deploy succeeds

### Step 4: Add Cloudflare edge rate limiting (recommended)

Create WAF rate limiting rules for:
- `/api/main-payment-element-init`
- `/api/main-subscribe`
- `/api/gift-payment-element-init`
- `/api/gift-payment-complete`

Why:
- App-level in-memory limiter is best effort; edge rules provide stronger global enforcement.

---

## 4) Operational behavior changes

Expected API behavior now:
- 400: invalid JSON, missing required fields, Turnstile failure
- 403: disallowed origin or required origin missing
- 413: payload too large
- 415: non-JSON content type for JSON endpoints
- 429: rate limit exceeded

Expected business behavior now:
- Replaying main subscription activation should not create duplicate active subscriptions.

---

## 5) Post-deploy validation checklist

1. Main checkout flow succeeds from production domain.
2. Gift checkout flow succeeds from production domain.
3. API call without Turnstile token fails when enforcement is required.
4. API call from non-allowed origin fails.
5. Repeated activation of same setup intent does not create duplicate active subscriptions.
6. `/api/health` returns only minimal output unless `x-health-key` matches.

---

## 6) Known limitations

- Current app-level rate limiting uses in-memory store per worker isolate (`functions/_lib/security.js`).
- For strict cross-isolate/global guarantees, use Cloudflare edge WAF rate limiting rules.

---

## 7) Change history

Security hardening implementation commit:
- `349ebe1`
