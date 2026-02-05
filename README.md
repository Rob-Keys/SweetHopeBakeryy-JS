# SweetHopeBakeryy

A small e-commerce site for a bakery in Arlington, VA. Customers browse products, add to cart, and checkout via Stripe.

https://www.sweethopebakeryy.com

## Tech Stack

- Pure static HTML + ES6 modules (no server, no framework)
- Bootstrap 5 for responsive layout
- Stripe Elements for payment UI
- localStorage for cart state, sessionStorage for admin auth
- JSON files for product/page data (fetched via `fetch()`)
- Cloudflare Pages Functions for Stripe/AWS/auth server endpoints

## Developing Locally

```bash
npm run dev
# → http://localhost:8080
```

This runs `npx serve src -l 8080`. Clean URLs are enabled via `src/serve.json`.

## Deployment

Deploy the `src/` directory to any static host (Cloudflare Pages, AWS Amplify, etc.). The host needs to support clean URLs (strip `.html` extensions) — configure rewrite rules accordingly.

## Env Vars (Cloudflare Pages)

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe checkout + verification |
| `AWS_KEY` | S3, SES |
| `AWS_SECRET_KEY` | S3, SES |
| `CAROLINE_EMAIL_ADDRESS` | Owner order notifications |
| `DEVELOPER_EMAIL_ADDRESS` | Developer order notifications |
| `ADMIN_PASSWORD_HASH` | PBKDF2 hash of admin password (`pbkdf2$<iterations>$<saltB64>$<hashB64>`) |
| `JWT_SECRET` | Random string for signing JWT tokens |
| `PUBLIC_SITE_URL` | Base URL used to build Stripe return URLs |

Optional: `AWS_REGION` (defaults to `us-east-1`)
Optional: `PAGES_DEPLOY_HOOK_URL` (triggers a deploy after admin edits)
Optional: `PAGES_PURGE_AFTER_DEPLOY` (set to `true` to purge Cloudflare cache after deploy)
Optional: `PAGES_PURGE_DELAY_MS` (delay purge after deploy, e.g. `15000`)
Optional: `PAGES_PURGE_DEBUG` (set to `true` to log purge/deploy hook status)
Optional: `CLOUDFLARE_ZONE_ID` or `CF_ZONE_ID` (required for cache purge)
Optional: `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` (required for cache purge; needs Cache Purge permission)

## Data Storage (KV)

Admin edits from `/customize` are stored in Cloudflare KV. Bind a KV namespace named `sweet-hope-bakeryy` to the binding `kv-db`.

Static page loads still read from `src/data/*.json`. To publish admin edits to the live site, trigger a rebuild that pulls the latest KV data into `src/data/*.json`.

Pull KV data into `src/data` during build:
```bash
CF_API_TOKEN=... CF_ACCOUNT_ID=... CF_KV_NAMESPACE_ID=... node scripts/pull-kv-data.mjs
```

Generate `ADMIN_PASSWORD_HASH` (max 100000 iterations — Cloudflare Workers limit):
```bash
node -e "const crypto=require('crypto'); const pw=process.argv[1]; const it=100000; const salt=crypto.randomBytes(16); crypto.pbkdf2(pw,salt,it,32,'sha256',(e,d)=>{ if(e) throw e; console.log('pbkdf2\$'+it+'\$'+salt.toString('base64')+'\$'+d.toString('base64'));});" 'YOUR_PASSWORD'
```

## Security Notes

- Stripe checkout pricing is validated server-side against `data/products.json`.
- Stripe `return_url` is built server-side from `PUBLIC_SITE_URL`.
- Admin mail inbox/outbox rendering escapes HTML to prevent XSS.
- Order confirmation emails are sent once per Stripe session (`/api/rate/verify-checkout` replay protection).
- S3 data/image routes validate table names and object keys to prevent path traversal.
- Rate limiting for `/api/rate/*` should be enforced via Cloudflare WAF/Rate Limiting rules.

## Original PHP Codebase

The original PHP 8.3/Apache application is preserved in `private/` and `public/` for reference. It is not used by the current site.
