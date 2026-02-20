# HabitBuddy Backend Bridge (Cloudflare Pages Functions)

Last updated: February 20, 2026

> For the unified history + setup + operations guide, use `HABITBUDDY_MASTER_RUNBOOK.md`.

## What was added

API routes (under `functions/api/`):
- `GET /api/health`
- `POST /api/main-payment-element-init`
- `POST /api/main-subscribe`
- `POST /api/gift-payment-element-init`
- `POST /api/gift-payment-complete`
- `POST /api/stripe-webhook`
- `GET /api/security-config`

Retired routes (return `410 Gone`):
- `POST /api/main-lead`
- `POST /api/gift-lead`
- `POST /api/main-checkout-session`
- `POST /api/gift-checkout-session`

Shared utilities:
- `functions/_lib/config.js`
- `functions/_lib/http.js`
- `functions/_lib/ghl.js`
- `functions/_lib/stripe.js`
- `functions/_lib/habitbuddy.js`

Frontend wiring:
- `maxsupport.html` now uses in-page Stripe Payment Element (`/api/main-payment-element-init` + `/api/main-subscribe`) with no hosted checkout redirect.
- `giftahabitbuddy.html` now uses in-page Stripe Payment Element (`/api/gift-payment-element-init` + `/api/gift-payment-complete`) with no hosted checkout redirect.
- forms now send stable plan keys (`main_trial`, `gift_1m`, `gift_3m`, `gift_6m`) to backend.
- `_redirects` keeps legacy `/home` traffic forwarding to `/`.

## Core behavior

### Main flow
1. Capture lead (first name/email/phone/habit/check-in)
2. Upsert contact in GHL
3. Create or update open opportunity in `Abandoned Cart`
4. Create Stripe SetupIntent and collect card in-page via Payment Element
5. Create Stripe subscription (7-day trial) server-side using saved payment method
6. Move opportunity to `Max Support (Trial)` and tag `hb_trial_started`

### Gift flow
1. Capture gifter + recipient details
2. Upsert gifter contact in GHL
3. Create or update open opportunity in `Abandoned Cart (Gifting)`
4. Create Stripe PaymentIntent and collect payment in-page via Payment Element
5. On successful payment:
   - upsert recipient contact
   - move existing gift opportunity from gifter contact to recipient contact via Associations API
   - write gift message to GHL opportunity custom field (`GHL_CF_OPP_GIFT_MESSAGE`) if configured
   - move stage to:
     - 1-month -> `Max Support (Paying)`
     - 3-month -> `Three Month Pass`
     - 6-month -> `Six Month Pass`

Privacy note:
- Gift message is no longer stored in Stripe metadata; it is handled in GHL opportunity fields.

## Required env vars (payments mode toggle)

Copy `.dev.vars.example` and set:
- `GHL_PRIVATE_TOKEN`
- `HB_PAYMENTS_MODE` (`test` or `live`)

Test-mode Stripe vars:
- `STRIPE_PUBLISHABLE_KEY_TEST`
- `STRIPE_SECRET_KEY_TEST`
- `STRIPE_WEBHOOK_SECRET_TEST`
- `STRIPE_MAIN_TRIAL_PRICE_ID_TEST`
- `STRIPE_GIFT_1M_PRICE_ID_TEST`
- `STRIPE_GIFT_3M_PRICE_ID_TEST`

Live-mode Stripe vars:
- `STRIPE_PUBLISHABLE_KEY_LIVE`
- `STRIPE_SECRET_KEY_LIVE`
- `STRIPE_WEBHOOK_SECRET_LIVE`
- `STRIPE_MAIN_TRIAL_PRICE_ID_LIVE`
- `STRIPE_GIFT_1M_PRICE_ID_LIVE`
- `STRIPE_GIFT_3M_PRICE_ID_LIVE`

The backend now fails fast if Stripe price IDs are missing, so these must be explicitly configured.

If 6-month gifting is enabled, set:
- `STRIPE_GIFT_6M_PRICE_ID_TEST`
- `STRIPE_GIFT_6M_PRICE_ID_LIVE`

Optional override only:
- `GHL_STAGE_SIX_MONTH_PASS_ID`
  - If omitted, backend uses the built-in default stage ID from `functions/_lib/config.js`.
- `GHL_CF_OPP_GIFT_MESSAGE`
  - Set this to your new GoHighLevel opportunity custom field ID for gift message.

Optional safety limit:
- `MAX_WEBHOOK_BODY_BYTES` (default `262144`)

Backwards compatibility:
- If mode-specific variables are not set, the app falls back to legacy variables (`STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and legacy `STRIPE_*_PRICE_ID` values).
- If `HB_PAYMENTS_MODE` is set, key format is validated (`pk_test_/sk_test_` for test mode and `pk_live_/sk_live_` for live mode).

### Switching from test to live

1. Fill all `*_LIVE` Stripe keys and live price IDs in Cloudflare Pages variables.
2. Change only `HB_PAYMENTS_MODE` from `test` to `live`.
3. Deploy.
4. Verify `GET /api/health` returns `"paymentsMode":"live"`.

Rollback is the reverse: set `HB_PAYMENTS_MODE=test` and redeploy.

## Plan catalog mode (recommended for future changes)

You can keep price-ID mode, or switch to catalog mode by setting one of:
- `HB_PLAN_CATALOG_JSON_TEST` and `HB_PLAN_CATALOG_JSON_LIVE` (recommended with mode toggle), or
- `HB_PLAN_CATALOG_JSON` (legacy/global fallback)

When present, this JSON drives plan behavior (price ID, stage ID, amount, aliases) without code edits.

High-level shape:
- keys are your internal `plan_key` values
- each plan supports:
  - `type`: `main` or `gift`
  - `mode`: `subscription` or `payment`
  - `label`
  - `priceId`
  - `stageId`
  - `amount`
  - optional `trialPeriodDays` (for subscription trials)
  - optional `aliases` (for backward compatibility)

Practical rule:
- updating price/stage for existing plan = env update + deploy
- adding a brand-new plan still needs frontend UI option, but backend checkout logic stays config-driven

## Stripe webhook setup

Endpoint URL (test/prod):
- `https://<your-domain>/api/stripe-webhook`

Recommended event:
- `checkout.session.completed`
- `customer.subscription.created`
- `payment_intent.succeeded`

Optional event (already handled):
- `checkout.session.async_payment_succeeded`
- `customer.subscription.updated`

## Cloudflare Pages deployment notes

1. Connect repo to Cloudflare Pages.
2. Set production branch.
3. Add all required env vars/secrets in Pages project settings.
4. Deploy.
5. In Stripe dashboard, set webhook endpoint to deployed URL.

## Important note on associations

This implementation uses GHL Associations API directly for opportunity-contact reassignment.
If you also want explicit gifter<->recipient contact-contact links, set:
- `GHL_GIFT_CONTACT_ASSOCIATION_KEY`

If that key is empty, contact-contact relation writes are skipped.
