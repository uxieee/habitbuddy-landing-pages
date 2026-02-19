# HabitBuddy Backend Bridge (Cloudflare Pages Functions)

Last updated: February 19, 2026

## What was added

API routes (under `functions/api/`):
- `GET /api/health`
- `POST /api/main-lead`
- `POST /api/gift-lead`
- `POST /api/main-checkout-session`
- `POST /api/gift-checkout-session`
- `POST /api/stripe-webhook`

Shared utilities:
- `functions/_lib/config.js`
- `functions/_lib/http.js`
- `functions/_lib/ghl.js`
- `functions/_lib/stripe.js`
- `functions/_lib/habitbuddy.js`

Frontend wiring:
- `maxsupport.html` now posts to `/api/main-checkout-session` and redirects to Stripe Checkout.
- `giftahabitbuddy.html` now posts to `/api/gift-checkout-session` and redirects to Stripe Checkout.
- forms now send stable plan keys (`main_trial`, `gift_1m`, `gift_3m`) to backend.
- `_redirects` maps clean paths (`/home`, `/maxsupport`, `/giftahabitbuddy`, `/thankyou`) to the corresponding HTML files.

## Core behavior

### Main flow
1. Capture lead (first name/email/phone/habit/check-in)
2. Upsert contact in GHL
3. Create or update open opportunity in `Abandoned Cart`
4. Create Stripe Checkout session for trial subscription (7-day trial)
5. On `checkout.session.completed`, move opportunity to `Max Support (Trial)`

### Gift flow
1. Capture gifter + recipient details
2. Upsert gifter contact in GHL
3. Create or update open opportunity in `Abandoned Cart (Gifting)`
4. Create Stripe Checkout session for one-time payment (1-month or 3-month)
5. On `checkout.session.completed`:
   - upsert recipient contact
   - move existing gift opportunity from gifter contact to recipient contact via Associations API
   - move stage to:
     - 1-month -> `Max Support (Paying)`
     - 3-month -> `Three Month Pass`

## Required env vars (baseline mode)

Copy `.dev.vars.example` and set:
- `GHL_PRIVATE_TOKEN`
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

Optional event (already handled):
- `checkout.session.async_payment_succeeded`

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
