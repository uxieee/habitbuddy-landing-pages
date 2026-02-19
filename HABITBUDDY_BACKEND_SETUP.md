# HabitBuddy Backend Bridge (Cloudflare Pages Functions)

Last updated: February 19, 2026

## What was added

API routes (under `functions/api/`):
- `GET /api/health`
- `POST /api/main-lead`
- `POST /api/gift-lead`
- `POST /api/main-checkout-session`
- `POST /api/gift-checkout-session`
- `POST /api/main-payment-element-init`
- `POST /api/main-subscribe`
- `POST /api/gift-payment-element-init`
- `POST /api/gift-payment-complete`
- `POST /api/stripe-webhook`

Shared utilities:
- `functions/_lib/config.js`
- `functions/_lib/http.js`
- `functions/_lib/ghl.js`
- `functions/_lib/stripe.js`
- `functions/_lib/habitbuddy.js`

Frontend wiring:
- `maxsupport.html` now uses in-page Stripe Payment Element (`/api/main-payment-element-init` + `/api/main-subscribe`) with no hosted checkout redirect.
- `giftahabitbuddy.html` now uses in-page Stripe Payment Element (`/api/gift-payment-element-init` + `/api/gift-payment-complete`) with no hosted checkout redirect.
- forms now send stable plan keys (`main_trial`, `gift_1m`, `gift_3m`) to backend.
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
   - move stage to:
     - 1-month -> `Max Support (Paying)`
     - 3-month -> `Three Month Pass`

## Required env vars (baseline mode)

Copy `.dev.vars.example` and set:
- `GHL_PRIVATE_TOKEN`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_MAIN_TRIAL_PRICE_ID`
- `STRIPE_GIFT_1M_PRICE_ID`
- `STRIPE_GIFT_3M_PRICE_ID`

The backend now fails fast if Stripe price IDs are missing, so these must be explicitly configured.

## Plan catalog mode (recommended for future changes)

You can keep baseline mode, or switch to catalog mode by setting:
- `HB_PLAN_CATALOG_JSON`

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
