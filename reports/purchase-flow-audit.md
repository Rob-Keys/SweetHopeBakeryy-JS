# Purchase flow audit

Assessed October 12, 2026, America/New_York. Scope: the deployed site at https://www.sweethopebakeryy.com and the current workspace purchase-flow implementation.

**Assessment: the live purchase flow is blocked at checkout session creation.** The catalog and cart work, but the observed customer could not reach the payment form. The implementation also has material risks in order fulfillment and recovery after payment.

No payment was submitted, no email was sent, and application code was not changed. Existing unrelated workspace changes were preserved. Post-payment checks used the actual verification handler with mocked Stripe, S3, and SES clients; they do not establish production payment or email behavior.

## Findings, in priority order

### 1. P0 — Live checkout cannot initialize

**Evidence: live browser reproduction.** On `/menu`, add 3 Maple Brown Sugar Cookies for $20, then choose Checkout. All three automatic POST attempts to `/api/rate/create-checkout` returned HTTP 500 with `{"error":"Internal error"}`. The publishable-key endpoint returned 200. The payment form never mounted and Pay Now remained disabled.

The failing request body was `{"cartLines":[{"name":"Maple Brown Sugar Cookies","quantityKey":"3"}]}`. First request correlation ID: Cloudflare ray `a49b24e4ffe42fe3-IAD`, approximately 11:09 p.m. EDT on October 12. This confirms the blocker for the exercised cart, not its underlying cause or duration.

**Action:** inspect Pages Function logs for that request. Check catalog loading, Stripe session creation, and S3 snapshot persistence independently. The catch at `functions/api/rate/create-checkout.js:143` hides the failing stage from the browser; the failure can occur after Stripe has created an unpaid session. Do not infer missing credentials or an invalid Stripe version from the generic response. Restore session creation first, then validate the payment element and a complete test-mode purchase.

### 2. P1 — Successful payment does not reliably trigger fulfillment

**Evidence: source review.** The only implemented order-email trigger is the browser return page calling verification (`src/js/pages/return.js:60`, `functions/api/rate/verify-checkout.js:205`). No Stripe webhook handler or reconciliation job exists in this repository. Closing the tab or losing connectivity after payment can prevent both customer and owner notifications.

**Action:** process verified Stripe completion events through an idempotent fulfillment function and durable retry mechanism. Keep the return page as an additional status/recovery path. Stripe explicitly explains why return-page-only fulfillment is unreliable: [Stripe fulfillment guidance](https://docs.stripe.com/checkout/fulfillment?payment-ui=checkout-form). An independently configured external fulfillment system was not inspected.

### 3. P1 — Contact and pickup details are not durably bound to the order

**Evidence: source review and mocked-handler reproduction.** Checkout saves customer details only in the browser (`src/js/pages/checkout.js:225`). The server snapshot contains cart and totals, but no name, phone, or pickup date (`functions/api/rate/create-checkout.js:99`). Verification trusts the details supplied on return, without validating the required fulfillment fields.

A paid mock session verified with `customerDetails: {}` still returned success, attempted both customer and owner emails, and wrote the sent marker. The owner email lacked the customer name and pickup details. Another browser cannot recover those details, and separate checkout tabs share one unscoped customer-details storage key.

**Action:** validate and persist contact/pickup details against the specific session before confirming payment. Fulfillment should load those stored details. Enforce the three-day calendar rule on the server in the bakery's timezone.

### 4. P1 — Failed notifications are permanently recorded as sent

**Evidence: mocked-handler reproduction.** Each SES rejection is caught and swallowed (`functions/api/rate/verify-checkout.js:240`). After all sends settle, the handler still writes the receipt marker at line 282. With both email sends forced to fail, verification returned `success: true` and wrote one marker. Subsequent verification will skip the sends.

The return page nevertheless states “A confirmation has been sent” (`src/js/pages/return.js:101`) and clears locally saved customer details.

**Action:** track delivery state per recipient; retain failures for retry. Payment success and notification delivery must have separate statuses. Show confirmation-delivery wording supported by that status, rather than asserting an email was sent.

### 5. P2 — Concurrent verification can send duplicate notifications

**Evidence: mocked-handler reproduction.** The HeadObject check and later PutObject are separate operations (`functions/api/rate/verify-checkout.js:217`, line 282). Two concurrent requests can both find no marker and send. In the reproduction, two verification calls produced four email attempts and two marker writes.

**Action:** use an atomic claim or serialized fulfillment operation per session, together with explicit retry state. A read-before-write marker alone does not provide concurrency safety.

### 6. P2 — Temporary verification errors are presented as failed orders

**Evidence: source review.** `didCheckoutSucceed` converts HTTP and network errors into `success: false` (`src/js/stripe/stripe.js:80`). The return page maps that result to “Order Failed” when an order snapshot exists (`src/js/pages/return.js:147`). A paid order can therefore look failed because Stripe or S3 is temporarily unavailable. There is no retry control or distinct pending-payment state, and the page gives no visible order reference.

**Action:** distinguish paid, processing, unpaid, and temporarily unverifiable states. Add a verification retry and an order reference. Preserve the order while status is uncertain and avoid prompting another payment.

### 7. P2 — Pickup-date calculation shifts the minimum by a day

**Evidence: date simulation.** The picker minimum adds three local days, then formats as UTC (`src/js/pages/checkout.js:106`). Submission instead compares a UTC-parsed date against the current timestamp plus two local days (line 212).

At October 12, 2026, 11:30 p.m. EDT, three calendar days means October 15. The picker minimum became October 16, and the click validator also rejected October 15. The late-evening browser session displayed October 16 as its minimum.

**Action:** calculate and compare calendar dates consistently in America/New_York. Use one rule for the input minimum, submit validation, and server validation.

### 8. P2 — Email synchronization depends on blur and is not awaited at payment

**Evidence: source review.** Stripe receives email through an async blur listener (`src/js/pages/checkout.js:298`). The Pay Now handler calls `confirm()` without passing email or awaiting that update (line 240). Session-restored or autofilled email can pass local validation without having reached Stripe; clicking directly out of the email field can race the pending update.

**Action:** pass the validated email to confirmation, or explicitly await and check `updateEmail` immediately before confirming. [Stripe's official SDK types](https://github.com/stripe/stripe-js/blob/master/types/stripe-js/checkout.d.ts) expose both APIs. This was not exercised against a mounted live payment form because of finding 1.

### 9. P2 — Checkout controls lack accessible labels and error announcements

**Evidence: browser accessibility tree and markup.** Name, email, phone, and pickup date have no associated labels (`src/checkout.html:47`). The first three appeared as unnamed textboxes. Error containers have no live-region semantics or links to their fields. Autocomplete attributes are absent.

**Action:** use associated labels, autocomplete tokens, `aria-describedby`, and announced errors. Handle form submission explicitly so keyboard submission follows the same validated payment path. Give remove buttons product-specific names rather than “X”.

## What worked

- Product selection, add-to-cart, persistence across navigation, and removal worked in the live browser.
- Adding $20 cookies and $25 snickerdoodles produced $45; removing snickerdoodles restored $20.
- The mobile cart was usable at 390 × 844. The inspected menu and checkout had no horizontal page overflow.
- Server checkout pricing is rebuilt from catalog quantity tiers rather than browser totals.
- Verification checks Stripe payment status, USD currency, and the server snapshot amount before declaring success.
- Order snapshots use S3 with a legacy KV fallback. Payment initialization offers bounded retries and a manual retry control.

## Recommended sequence and remaining validation

1. Diagnose and restore live checkout session creation.
2. Persist validated fulfillment details per session before payment.
3. Implement webhook-driven fulfillment with atomic coordination and recipient-specific retries.
4. Repair date validation, email synchronization, return-page recovery, and accessibility.
5. Exercise a complete test-mode purchase, decline, authentication challenge, abandoned return, temporary verification outage, duplicate webhook, and SES failure/retry.

Live payment success, card declines, authentication challenges, actual SES delivery, provider dashboards, infrastructure logs, and any externally configured fulfillment were not verified. There is no existing test script in package.json. This assessment combines observed browser behavior with targeted local reproductions and source findings; it is not a complete security audit.
