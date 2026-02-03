# SweetHopeBakeryy

A small e-commerce site for a bakery in Arlington, VA. Customers browse products, add to cart, and checkout via Stripe.

https://www.sweethopebakeryy.com

## Tech Stack

- Pure static HTML + ES6 modules (no server, no framework)
- Bootstrap 5 for responsive layout
- Stripe Elements for payment UI
- localStorage for cart state, sessionStorage for admin auth
- JSON files for product/page data (fetched via `fetch()`)

## Developing Locally

```bash
npm run dev
# → http://localhost:8080
```

This runs `npx serve src -l 8080`. Clean URLs are enabled via `src/serve.json`.

## Deployment

Deploy the `src/` directory to any static host (Cloudflare Pages, AWS Amplify, etc.). The host needs to support clean URLs (strip `.html` extensions) — configure rewrite rules accordingly.

## Stubbed Functionality

AWS and Stripe server-side operations (checkout session creation, payment verification, S3 image uploads, SES email sending, database writes) are stubbed with `console.warn` + TODO comments. These will be implemented as Lambda functions behind API Gateway. See `CLAUDE.md` for the full list with input/output specs.

## Original PHP Codebase

The original PHP 8.3/Apache application is preserved in `private/` and `public/` for reference. It is not used by the current site.
