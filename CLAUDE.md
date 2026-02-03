# CLAUDE.md

## Project Overview
Sweet Hope Bakery — static e-commerce site. Pure HTML + ES6 modules, no server. Converted from PHP 8.3/Apache. AWS and Stripe server-side operations are stubbed for future Lambda migration.

## Quick Start
```bash
npm run dev   # → http://localhost:8080
```
Admin dev password: `password`

## Architecture Rules
- **Page init order matters**: `DOMContentLoaded` → `renderHeader()` → fetch data → render content → `renderFooter()` → `initShared()`. The `initShared()` call MUST come last — it attaches IntersectionObservers and ImageSliders to elements that must already be in the DOM.
- **Header/footer are injected via JS** into `<div id="header-placeholder">` and `<div id="footer-placeholder">`. Every HTML page has these.
- **Clean URLs** (`/about` not `/about.html`): handled by `serve.json` `cleanUrls: true` locally. Production hosts need equivalent rewrite rules.
- **Admin auth is client-side only** — password hash lives in `config.js`. This is a placeholder until Lambda auth is built. Not secure.
- **All writes are stubbed** — `putItem()`, `removeItem()`, image uploads, email sending all log warnings. Only reads (JSON fetches) work.

## Where Things Live
- `src/` — the entire deployable static site
- `src/js/modules/` — core logic: `config.js`, `database.js`, `cart.js`, `auth.js`, `email-receipt.js`
- `src/js/pages/` — one script per page (home, about, menu, contact, checkout, return, customize, mail)
- `src/js/components/` — reusable HTML generators: `header.js`, `footer.js`, `product.js`, `customize-page.js`
- `src/js/aws/` + `src/js/stripe/` — stubbed server-side operations
- `src/js/shared.js` — ImageSlider class + fade-in scroll animations
- `src/data/` — JSON data files (products, home/about/contact page sections)
- `private/` + `public/` — original PHP codebase (reference only, not used)

## Stubbed Functions (Future Lambdas)
| Function | File | Expected Lambda I/O |
|---|---|---|
| `createStripeCheckout()` | `stripe/stripe.js` | `{ lineItems, returnUrl }` → `{ clientSecret }` |
| `didCheckoutSucceed()` | `stripe/stripe.js` | `{ sessionId }` → `{ success, customerEmail }` |
| `uploadImages()` | `aws/s3.js` | Files → presigned URLs or direct S3 upload |
| `deleteImages()` | `aws/s3.js` | `{ s3Keys[] }` → `{ success }` |
| `getInbox()` / `getOutbox()` | `aws/s3.js` | `{}` → `{ emails[] }` |
| `sendEmail()` | `aws/ses.js` | `{ from, to[], subject, body }` → `{ success }` |
| `putItem()` / `removeItem()` | `modules/database.js` | `{ tableName, item/key }` → `{ success }` |

## Key State Keys
- **localStorage**: `shb_cart` (cart items), `shb_customer` (checkout form details), `shb_completed_order` (snapshot for return page)
- **sessionStorage**: `shb_auth` (admin password hash), `shb_desired_page` (redirect target after login)
- **In-memory**: `database.js` caches fetched JSON data
