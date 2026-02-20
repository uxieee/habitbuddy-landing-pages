# HabitBuddy Master Runbook (History + Setup + Operations)

Last updated: February 20, 2026  
Repository: `/Users/uxie/Documents/Vibe Code/Habit Buddy/landing-pages`  
Current production commit: `9a33a85`

This is the single source of truth for:
- What changed historically
- What is live now
- What you must configure in Cloudflare, Stripe, and GoHighLevel
- How to verify and troubleshoot production

## 1) What You Need To Do Right Now

1. In Cloudflare Pages, set all required env vars (Section 5).
2. Optional but recommended: set `GHL_CF_OPP_GIFT_MESSAGE` to your GoHighLevel opportunity custom field ID for "Gift Message" (`QlQy70D3GiL6vTyjj2ma` for location `3ouY0YkB0fLDFs5nb8UG`).
3. Configure Stripe webhook events and secret for the same mode as `HB_PAYMENTS_MODE` (Section 7).
4. Deploy.
5. Run the post-deploy checklist (Section 10).

If you only do one thing, do Section 5 carefully. Most runtime failures come from missing/mismatched env vars.

## 2) Current Live Behavior (As Of `9a33a85`)

### Active API endpoints
- `GET /api/health`
- `GET /api/security-config`
- `POST /api/main-payment-element-init`
- `POST /api/main-subscribe`
- `POST /api/gift-payment-element-init`
- `POST /api/gift-payment-complete`
- `POST /api/stripe-webhook`

### Retired API endpoints (intentional `410 Gone`)
- `POST /api/main-lead`
- `POST /api/gift-lead`
- `POST /api/main-checkout-session`
- `POST /api/gift-checkout-session`

### Payment architecture
- Main flow uses Stripe Payment Element + SetupIntent + server-side subscription creation.
- Gift flow uses Stripe Payment Element + PaymentIntent + server-side completion sync.
- Legacy hosted Checkout Session routes are retired.

### Gift message handling (important)
- Gift message is no longer stored in Stripe metadata.
- Gift message is stored on GHL opportunity custom field via `GHL_CF_OPP_GIFT_MESSAGE`.

## 3) Historical Change Timeline (Git)

The following commits are the sequence after baseline `d310766`:

| Commit | Git Date | Summary | Operational Impact |
|---|---|---|---|
| `5b0c77d` | 2026-02-20 | Clean repository to website runtime files only | Removed non-runtime clutter |
| `349ebe1` | 2026-02-20 | Harden checkout APIs and frontend with security controls | Added core security controls |
| `301add8` | 2026-02-20 | Add security hardening runbook and Cloudflare checklist | Added security setup documentation |
| `b048047` | 2026-02-20 | Rollback codebase to `d310766` baseline | Temporary rollback |
| `e414e11` | 2026-02-20 | Fix Stripe flow by submitting Payment Element before confirm | Fixed Stripe `elements.submit()` integration issue |
| `8a4c033` | 2026-02-20 | Harden checkout APIs and frontend with security controls | Re-applied hardening after rollback |
| `9540d40` | 2026-02-20 | Add security hardening runbook and Cloudflare checklist | Updated docs again |
| `4cdd129` | 2026-02-20 | Add payments mode toggle for test/live Stripe config | Introduced `HB_PAYMENTS_MODE` and mode-scoped keys/prices |
| `cb5c803` | 2026-02-21 | Clarify six-month stage ID is optional override | Documentation clarification |
| `9a33a85` | 2026-02-21 | Harden API surface and move gift message to GHL | Retired legacy endpoints, added webhook body limit, Turnstile action/hostname checks, moved gift message to GHL field |

Note: Git date is shown exactly as recorded by git.

## 4) Security Controls Now Enforced

- Origin allowlist (`ALLOWED_ORIGINS`)
- Optional required `Origin` header (`REQUIRE_ORIGIN_HEADER`)
- In-memory per-IP per-route rate limiting
- Turnstile token verification
- Turnstile hostname verification
- Turnstile action binding per endpoint
- JSON content-type/body-size checks
- Stripe webhook raw-body size checks (`MAX_WEBHOOK_BODY_BYTES`)
- Stripe webhook signature verification (HMAC + timestamp tolerance)
- Retired legacy write routes return `410 Gone`

## 5) Cloudflare Pages Env Vars (Required/Recommended)

Use `.dev.vars.example` as template.

### Required for checkout + webhook
- `GHL_PRIVATE_TOKEN`
- `HB_PAYMENTS_MODE` (`test` or `live`)
- `STRIPE_PUBLISHABLE_KEY_TEST`
- `STRIPE_SECRET_KEY_TEST`
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_PUBLISHABLE_KEY_LIVE`
- `STRIPE_SECRET_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `STRIPE_MAIN_TRIAL_PRICE_ID_TEST`
- `STRIPE_GIFT_1M_PRICE_ID_TEST`
- `STRIPE_GIFT_3M_PRICE_ID_TEST`
- `STRIPE_MAIN_TRIAL_PRICE_ID_LIVE`
- `STRIPE_GIFT_1M_PRICE_ID_LIVE`
- `STRIPE_GIFT_3M_PRICE_ID_LIVE`

### Required for security hardening
- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_ENFORCEMENT=required`
- `ALLOWED_ORIGINS=https://tryhabitbuddy.com,https://<your-project>.pages.dev`
- `REQUIRE_ORIGIN_HEADER=true`
- `MAX_JSON_BODY_BYTES=32768`
- `MAX_WEBHOOK_BODY_BYTES=262144`
- `RATE_LIMIT_WINDOW_SECONDS=60`
- `RATE_LIMIT_MAX_REQUESTS=30`
- `HEALTH_STATUS_KEY=<long random secret>`

### Optional / conditional
- `STRIPE_GIFT_6M_PRICE_ID_TEST` and `STRIPE_GIFT_6M_PRICE_ID_LIVE` (if 6-month gift enabled)
- `GHL_STAGE_SIX_MONTH_PASS_ID` (override only; default exists in code)
- `GHL_GIFT_CONTACT_ASSOCIATION_KEY` (if you want explicit contact-to-contact gifter/recipient link)
- `GHL_CF_OPP_GIFT_MESSAGE` (recommended explicit override; fallback default in code is `QlQy70D3GiL6vTyjj2ma`)
- `HB_PLAN_CATALOG_JSON_TEST` / `HB_PLAN_CATALOG_JSON_LIVE` (advanced config-driven plan catalog)

## 6) Cloudflare Setup Steps

### Turnstile
1. Create an Invisible Turnstile widget.
2. Add production domain and Pages preview domain.
3. Copy site key and secret into Pages vars.

### WAF rate limiting (recommended)
Create rate-limit rules for:
- `/api/main-payment-element-init`
- `/api/main-subscribe`
- `/api/gift-payment-element-init`
- `/api/gift-payment-complete`

### Security headers
Headers are managed in `_headers` and include CSP, frame protections, nosniff, referrer policy, and permissions policy.

## 7) Stripe Setup Steps

1. Ensure products/prices exist in both test and live.
2. Put the correct mode-specific keys/prices in Cloudflare vars.
3. Set webhook endpoint:
- `https://<your-domain>/api/stripe-webhook`
4. Enable webhook events:
- `payment_intent.succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `checkout.session.completed` (handled for compatibility)
- `checkout.session.async_payment_succeeded` (handled for compatibility)
5. Copy webhook secret into the matching mode var:
- test: `STRIPE_WEBHOOK_SECRET_TEST`
- live: `STRIPE_WEBHOOK_SECRET_LIVE`

Critical: `HB_PAYMENTS_MODE` and webhook secret mode must match.

## 8) GoHighLevel Setup Steps

1. Confirm pipeline and stage IDs are correct (or use defaults).
2. Create opportunity custom field: `Gift Message` (if not already created).
3. Copy that custom field ID into:
- `GHL_CF_OPP_GIFT_MESSAGE` (`QlQy70D3GiL6vTyjj2ma` for your current location)
4. Keep existing opportunity/contact custom field IDs configured if you use overrides.

## 9) Deployment Procedure

1. Update env vars in Cloudflare Pages (Preview + Production as needed).
2. Deploy from `main`.
3. Verify `GET /api/health` returns success.
4. Verify full main and gift flows in browser.
5. Verify Stripe webhooks are delivered successfully.
6. Verify GHL opportunity is updated correctly, including gift message field.

## 10) Post-Deploy Verification Checklist

### Functional
- Main flow: card setup + subscription activation succeeds.
- Gift flow: payment succeeds and completion sync succeeds.
- Thank-you pages load correctly.

### Security
- Missing Turnstile token fails when enforcement is required.
- Wrong origin fails with `403`.
- Oversized JSON fails with `413`.
- Oversized webhook body fails with `413`.
- Rate-limited abuse returns `429`.

### Data integrity
- Gift message appears in GHL opportunity custom field.
- No gift message appears in Stripe metadata.
- Duplicate main-subscribe retry with same SetupIntent does not create duplicate active subscriptions.

## 11) Troubleshooting Guide

### `elements.submit() must be called before stripe.confirmSetup()/confirmPayment()`
- Already fixed in frontend flow.
- If seen again, ensure deployment includes commit `e414e11` or later.

### `Human verification failed. Please try again.`
Check:
- Turnstile keys set
- Domain is registered in Turnstile
- `ALLOWED_ORIGINS` includes the exact site origin
- Endpoint action is not modified in frontend scripts

### `Invalid Stripe signature.`
Check:
- Correct webhook secret for current mode
- Webhook endpoint points to current domain

### Gift message missing in GHL
Check:
- `GHL_CF_OPP_GIFT_MESSAGE` set to correct opportunity field ID
- Field exists in correct GHL object scope (opportunity, not contact)

### `410 Gone` errors
- You are calling retired endpoints.
- Update callers to:
  - main: `/api/main-payment-element-init` -> `/api/main-subscribe`
  - gift: `/api/gift-payment-element-init` -> `/api/gift-payment-complete`

## 12) Mode Switching and Rollback

### Test -> Live switch
1. Fill all `*_LIVE` vars.
2. Set `HB_PAYMENTS_MODE=live`.
3. Deploy.
4. Confirm health shows `"paymentsMode":"live"`.

### Live -> Test rollback
1. Set `HB_PAYMENTS_MODE=test`.
2. Deploy.
3. Re-verify health and test transactions.

## 13) File Map (Where Things Live)

- Main backend logic: `functions/_lib/habitbuddy.js`
- Env/config parsing: `functions/_lib/config.js`
- Security middleware: `functions/_lib/security.js`
- HTTP parser/response helpers: `functions/_lib/http.js`
- Stripe client/signature: `functions/_lib/stripe.js`
- GHL client: `functions/_lib/ghl.js`
- Main checkout page: `maxsupport.html`
- Gift checkout page: `giftahabitbuddy.html`
- Security runbook: `SECURITY-HARDENING-RUNBOOK.md`
- Backend setup notes: `HABITBUDDY_BACKEND_SETUP.md`
- API contract: `docs/openapi.yaml`

## 14) Document Status

This file is intended to replace day-to-day use of:
- `SECURITY-HARDENING-RUNBOOK.md`
- `HABITBUDDY_BACKEND_SETUP.md`

Keep those files for reference/history, but use this master runbook for operations.
