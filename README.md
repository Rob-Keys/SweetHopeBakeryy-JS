# Sweet Hope Bakery

E-commerce site for a bakery in Arlington, VA. Converted from a hand-written PHP 8.3 / Apache app to client-side JavaScript on Cloudflare Pages. Built with Claude as a development tool — I own the architecture and review every line.

https://www.sweethopebakeryy.com

## From PHP to JS

The original was a LAMP stack: server-rendered PHP, Apache routing, direct MySQL/S3/SES calls. The rewrite eliminates the server. Static HTML + ES6 modules handle rendering. Server-side work (Stripe, AWS, auth) runs as Cloudflare Pages Functions — small serverless endpoints that only exist where secrets or trust are required.

No framework, no bundler, no build step. The browser loads ES6 modules directly.

## How It Fits Together

Each page has a script in `src/js/pages/` that runs on `DOMContentLoaded`:
1. Inject header/footer from `src/js/components/`
2. Fetch data from `/api/get-data` (Cloudflare KV)
3. Render page content
4. `initShared()` runs last — attaches scroll animations and image sliders to the now-present DOM

Core modules (`src/js/modules/`) handle cart state, auth tokens, and data fetching. Stripe and AWS client wrappers call `/api/*` endpoints. Reusable UI components live in `src/js/components/`.

## Data + Caching

All content lives in Cloudflare KV. No static JSON files, no database server.

```
Admin edit  →  POST /api/save-data (writes KV)  →  CDN cache purge
Page load   →  GET /api/get-data (reads KV)      →  edge-cached 24h
```

Writes trigger a `purge_everything` against the Cloudflare zone API. Next read hits KV fresh, CDN caches it again. Static assets (JS, CSS, images) are cached aggressively at the edge and invalidated on deploy.

## Security

The browser is untrusted. All sensitive operations stay server-side:

- **Pricing** — Checkout sessions are created server-side from KV prices, not client-submitted totals
- **Payments** — Stripe verification and order emails run server-side only
- **Auth** — Admin JWT via PBKDF2 password verification, stored in `sessionStorage`, verified on every write endpoint
- **Data reads are public** — intentionally, since the data is already visible on the site. Enables CDN caching without auth overhead
- **Secrets** — Stripe/AWS keys and JWT secret are Cloudflare environment secrets, never exposed to the client
- **Validation** — KV table names allowlisted, S3 keys validated against path traversal, HTML escaped in mail rendering

## Local Dev

```bash
npm run dev                    # static files at localhost:8080
npx wrangler pages dev src     # with Pages Functions + KV
```

## Admin Authentication

Configure `ADMIN_PASSWORD_HASH` as a Cloudflare Pages secret using the project's PBKDF2-SHA256 format. Generate the hash through your approved private deployment tooling or password-management workflow; never commit the password or hash to the repository.
