# CLAUDE.md

## Project Overview
Sweet Hope Bakery — static e-commerce site. HTML and Bun-built browser bundles are served by Cloudflare Pages. Content JSON is bundled into page scripts. Server-side operations (Stripe, AWS S3/SES, auth) run as Cloudflare Pages Functions.

## Quick Start
```bash
bun run build # build static assets to dist/
npm run dev   # → http://localhost:8080 (static files only, no functions)
```
Admin authentication requires a privately configured `ADMIN_PASSWORD_HASH` when running the Pages Functions locally.

## Architecture Rules
- **Page init order matters**: `DOMContentLoaded` → `renderHeader()` → read bundled data → render content → `renderFooter()` → `initShared()`. The `initShared()` call MUST come last — it attaches IntersectionObservers and ImageSliders to elements that must already be in the DOM.
- **Header/footer are injected via JS** into `<div id="header-placeholder">` and `<div id="footer-placeholder">`. Every HTML page has these.
- **Clean URLs** (`/about` not `/about.html`): handled by `serve.json` `cleanUrls: true` locally. Cloudflare Pages handles this automatically in production.
- **Content data** lives in `src/data/{products,home_page,about_page,contact_page}.json`. Browser bundles import it; checkout imports `products.json` for server-side price validation. Do not read or write content through KV.
- **Build**: Cloudflare Pages runs `bun run build` and serves `dist/`. The build copies static files and bundles each `src/js/pages/` JavaScript or TypeScript entry point with its imported data.
- **Admin auth uses JWT** — password is POST'd to `/api/authenticate`, server verifies PBKDF2 hash in `ADMIN_PASSWORD_HASH`, returns a signed JWT. Token stored in `sessionStorage['shb_auth']`, sent as `Authorization: Bearer <token>` on all admin API calls. Server verifies JWT before executing any admin endpoint.
- **Rate limiting** — `/api/authenticate` should be protected by Cloudflare WAF/Rate Limiting rules (per-IP).
- **Order emails are server-side** — Stripe's `/api/rate/stripe-webhook` is the primary fulfillment path, and `verify-checkout` is the customer return/recovery path. Both verify payment and share per-recipient idempotent delivery state. No unprotected email endpoints.

## Where Things Live
- `src/` — the deployable static site
- `src/js/modules/` — core logic: `config.js`, `database.js`, `cart.js`, `auth.js`
- `src/js/pages/` — one script per page (home, about, menu, contact, checkout, return, customize, mail)
- `src/js/components/` — reusable HTML generators: `header.js`, `footer.js`, `product.js`, `customize-page.js`
- `src/js/aws/` + `src/js/stripe/` — client-side modules that call `/api/*` endpoints
- `src/js/shared.js` — ImageSlider class + fade-in scroll animations
- `functions/api/` — Cloudflare Pages Functions (server-side, access env vars)
  - `_jwt.js`, `_auth.js` — helpers (prefixed with `_`, not routed as endpoints)

## Cloudflare Pages Functions (`functions/api/`)
All server-side operations run as Cloudflare Pages Functions. Each file maps to an API route automatically. Files prefixed with `_` are helpers, not endpoints.

| Endpoint | Method | Auth | Function |
|---|---|---|---|
| `/api/authenticate` | POST | — | Verify password, return JWT |
| `/api/create-checkout` | POST | — | Create Stripe checkout session (server-side price validation) |
| `/api/verify-checkout` | POST | — | Verify Stripe payment + send order emails |
| `/api/send-email` | POST | JWT | Admin compose — send single email via SES |
| `/api/get-inbox` | GET | JWT | List emails from S3 inbox |
| `/api/get-outbox` | GET | JWT | List emails from S3 outbox |
| `/api/upload-images` | POST | JWT | Generate presigned S3 upload URLs |
| `/api/delete-images` | POST | JWT | Delete images from S3 |
| `/api/save-data` | POST | JWT | Apply a deterministic edit to a repository JSON file through the relay and commit to GitHub |
| `/api/delete-data` | POST | JWT | Apply a deterministic deletion to a repository JSON file through the relay and commit to GitHub |

## Env Vars (Cloudflare Pages)

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe checkout + verification |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signature verification |
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
- **Cloudflare KV**: retained for order snapshots created by legacy checkout flows
