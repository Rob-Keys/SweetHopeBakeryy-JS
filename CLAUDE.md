# CLAUDE.md

## Project Overview
Sweet Hope Bakery — static e-commerce site. Pure HTML + ES6 modules served by Cloudflare Pages. Server-side operations (Stripe, AWS S3/SES, auth) run as Cloudflare Pages Functions.

## Quick Start
```bash
npm run dev   # → http://localhost:8080 (static files only, no functions)
```
Admin dev password: `password` (only if you generated `ADMIN_PASSWORD_HASH` for it)

## Architecture Rules
- **Page init order matters**: `DOMContentLoaded` → `renderHeader()` → fetch data → render content → `renderFooter()` → `initShared()`. The `initShared()` call MUST come last — it attaches IntersectionObservers and ImageSliders to elements that must already be in the DOM.
- **Header/footer are injected via JS** into `<div id="header-placeholder">` and `<div id="footer-placeholder">`. Every HTML page has these.
- **Clean URLs** (`/about` not `/about.html`): handled by `serve.json` `cleanUrls: true` locally. Cloudflare Pages handles this automatically in production.
- **Admin auth uses JWT** — password is POST'd to `/api/authenticate`, server verifies PBKDF2 hash in `ADMIN_PASSWORD_HASH`, returns a signed JWT. Token stored in `sessionStorage['shb_auth']`, sent as `Authorization: Bearer <token>` on all admin API calls. Server verifies JWT before executing any admin endpoint.
- **Rate limiting** — `/api/authenticate` should be protected by Cloudflare WAF/Rate Limiting rules (per-IP).
- **Order emails are server-side** — sent by `verify-checkout` after confirming Stripe payment. No unprotected email endpoints.

## Where Things Live
- `src/` — the deployable static site
- `src/js/modules/` — core logic: `config.js`, `database.js`, `cart.js`, `auth.js`
- `src/js/pages/` — one script per page (home, about, menu, contact, checkout, return, customize, mail)
- `src/js/components/` — reusable HTML generators: `header.js`, `footer.js`, `product.js`, `customize-page.js`
- `src/js/aws/` + `src/js/stripe/` — client-side modules that call `/api/*` endpoints
- `src/js/shared.js` — ImageSlider class + fade-in scroll animations
- `src/data/` — JSON data files (fallback/seed only; live data is served from KV via `/api/get-data`)
- `functions/api/` — Cloudflare Pages Functions (server-side, access env vars)
  - `_jwt.js`, `_auth.js` — helpers (prefixed with `_`, not routed as endpoints)

## Cloudflare Pages Functions (`functions/api/`)
All server-side operations run as Cloudflare Pages Functions. Each file maps to an API route automatically. Files prefixed with `_` are helpers, not endpoints.

| Endpoint | Method | Auth | Function |
|---|---|---|---|
| `/api/authenticate` | POST | — | Verify password, return JWT |
| `/api/get-data` | GET | — | Read JSON table from KV (edge-cached, purged on writes) |
| `/api/create-checkout` | POST | — | Create Stripe checkout session (server-side price validation) |
| `/api/verify-checkout` | POST | — | Verify Stripe payment + send order emails |
| `/api/send-email` | POST | JWT | Admin compose — send single email via SES |
| `/api/get-inbox` | GET | JWT | List emails from S3 inbox |
| `/api/get-outbox` | GET | JWT | List emails from S3 outbox |
| `/api/upload-images` | POST | JWT | Generate presigned S3 upload URLs |
| `/api/delete-images` | POST | JWT | Delete images from S3 |
| `/api/save-data` | POST | JWT | Upsert item in JSON data file on KV |
| `/api/delete-data` | POST | JWT | Remove item from JSON data file on KV |

## Env Vars (Cloudflare Pages)

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe checkout + verification |
| `AWS_KEY` | S3, SES |
| `AWS_SECRET_KEY` | S3, SES |
| `CAROLINE_EMAIL_ADDRESS` | Owner order notifications |
| `DEVELOPER_EMAIL_ADDRESS` | Developer order notifications |
| `ADMIN_PASSWORD_HASH` | PBKDF2 hash (`pbkdf2$<iterations>$<saltB64>$<hashB64>`) |
| `JWT_SECRET` | Random string for signing JWT tokens |
| `PUBLIC_SITE_URL` | Base URL used to build Stripe return URLs |

Optional: `AWS_REGION` (defaults to `us-east-1`)

## Auth Flow
1. User visits `/customize` or `/mail` → `isAuthenticated()` checks for JWT in sessionStorage → false → redirect to `/authenticate`
2. User types password → POST `/api/authenticate` `{ password }` → server verifies PBKDF2 hash in `ADMIN_PASSWORD_HASH`
3. Match → returns signed JWT (24hr expiry) → stored in `sessionStorage['shb_auth']`
4. All admin API calls include `Authorization: Bearer <token>` header
5. Server verifies JWT signature + expiry before executing
6. 401 response → client clears token and redirects to `/authenticate`

## Key State Keys
- **localStorage**: `shb_cart` (cart lines + summary), `shb_customer` (checkout form details), `shb_completed_order` (snapshot for return page)
- **sessionStorage**: `shb_auth` (JWT token), `shb_desired_page` (redirect target after login)
- **In-memory**: `database.js` caches fetched JSON data
