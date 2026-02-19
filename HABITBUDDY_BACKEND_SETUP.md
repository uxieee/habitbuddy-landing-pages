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

## Required env vars

Copy `.dev.vars.example` and set:
- `GHL_PRIVATE_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Everything else has defaults for your current HabitBuddy test account, but can be overridden.

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
