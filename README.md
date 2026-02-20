# Habit Buddy Website

This repository contains the production website for Habit Buddy: a text-message-based habit coaching service.

## What The Website Includes

- Landing page (`index.html`)
  - Brand story, features, FAQ, and CTAs into checkout
  - Main offer messaging: free 7-day trial for Max Support
- Main checkout page (`maxsupport.html`)
  - Collects customer info and preferred text time
  - Starts payment setup flow for the subscription
- Gift checkout page (`giftahabitbuddy.html`)
  - One-time gift purchase options:
    - 1 month: `$29.99`
    - 3 months: `$79.99`
    - 6 months: `$139.99`
  - Optional gift message support
- Post-purchase/activation page (`thankyou.html`)
- Legal pages (`privacy.html`, `terms.html`)

## Backend/API (Cloudflare Pages Functions)

API logic is implemented in `functions/` and serves the website checkout flows.

Key endpoints used by the frontend:

- `POST /api/security-config`
- `POST /api/main-payment-element-init`
- `POST /api/main-subscribe`
- `POST /api/gift-payment-element-init`
- `POST /api/gift-payment-complete`
- `POST /api/stripe-webhook`

Supporting shared logic lives in `functions/_lib/` (Stripe, security, GoHighLevel, config, HTTP helpers).

## Deployment Target

- Cloudflare Pages (static HTML + Pages Functions)
- Runtime config is injected through Cloudflare environment variables

## Repository Scope

This repo is intentionally runtime-only:

- Includes only website/app files required for serving pages and API flows
- Excludes internal documents, audits, reports, and screenshots
