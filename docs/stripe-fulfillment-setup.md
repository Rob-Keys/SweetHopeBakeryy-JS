# Stripe purchase-flow fulfillment setup

The Pages Function at `/api/rate/stripe-webhook` verifies Stripe signatures, retrieves the current Checkout Session from Stripe, checks it against the server order snapshot, and sends order notifications. The return page calls the same fulfillment path for immediate customer feedback.

## Required Stripe configuration

Register a public HTTPS webhook in Stripe Workbench for the production site:

- URL: `https://www.sweethopebakeryy.com/api/rate/stripe-webhook`
- Payload: snapshot events
- Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
- Store the endpoint's signing secret as the Cloudflare Pages secret `STRIPE_WEBHOOK_SECRET` in each environment where the endpoint is enabled. Keep the test and live secrets separate.

The endpoint deliberately returns a non-2xx response when Stripe retrieval, snapshot validation, or notification delivery fails. Stripe retries failed live deliveries with exponential backoff for up to three days. Notification state is stored per recipient in S3 using conditional writes, so retries skip successful recipients and retry failed ones. If automatic retries are exhausted, use Stripe Workbench's event delivery retry controls.

## Required S3 access

The Pages Function credentials need `s3:GetObject` and `s3:PutObject` access to `sweethopebakeryy/orders/*`. Recipient claims use `If-None-Match` for first creation and `If-Match` when taking over a failed or expired claim. Amazon S3 supports these conditional writes for `PutObject`; its conditional update operation needs both read and write permissions.

Older order email markers at `orders/{session_id}.json` do not record per-recipient results. The new flow will not resend for those old sessions; the return page reports their delivery status as unknown to avoid duplicating a possibly delivered message.

## Checkout diagnostics

Checkout creation logs a structured `stage` and the Cloudflare Ray ID while keeping the customer response generic. Use the Pages Function invocation logs for that Ray ID to distinguish catalog loading, Stripe session creation, and order snapshot persistence failures. The checkout request also uses a browser-generated Stripe idempotency key so automatic retries reuse a session if Stripe created it before the snapshot write failed.
