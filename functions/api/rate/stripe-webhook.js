// POST /api/rate/stripe-webhook
// Stripe retries non-2xx responses, providing durable delivery retries for fulfillment.

import { stripeRequest } from '../_stripe.js';
import { loadOrderSnapshot } from '../_orders.js';
import { fulfillPaidOrder, NotificationDeliveryError } from '../_fulfillment.js';
import { verifyStripeSignature } from '../_stripe-webhook.js';

const FULFILLMENT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
]);
const MAX_EVENT_BYTES = 1024 * 1024;

async function readBoundedBody(request) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EVENT_BYTES) {
        await reader.cancel();
        throw new RangeError('Webhook payload too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isValidOrderSnapshot(snapshot) {
  return Boolean(
    snapshot && Array.isArray(snapshot.cartLines) && snapshot.cartLines.length > 0 &&
    snapshot.cart && typeof snapshot.cart === 'object' && !Array.isArray(snapshot.cart) &&
    Number.isSafeInteger(snapshot.amount_total) && snapshot.amount_total > 0 &&
    Number.isFinite(Number(snapshot.cart_total)) && Number(snapshot.cart_total) > 0
  );
}

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = context.env;
  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    console.error(JSON.stringify({ message: 'stripe_webhook_not_configured' }));
    return Response.json({ error: 'Webhook is temporarily unavailable' }, { status: 503 });
  }

  const contentLength = Number(context.request.headers.get('content-length') || 0);
  if (contentLength > MAX_EVENT_BYTES) {
    return Response.json({ error: 'Webhook payload too large' }, { status: 413 });
  }

  let payload;
  try {
    payload = await readBoundedBody(context.request);
  } catch (err) {
    const status = err instanceof RangeError ? 413 : 400;
    return Response.json({ error: status === 413 ? 'Webhook payload too large' : 'Invalid webhook payload' }, { status });
  }

  const validSignature = await verifyStripeSignature(
    payload,
    context.request.headers.get('stripe-signature'),
    STRIPE_WEBHOOK_SECRET
  );
  if (!validSignature) {
    return Response.json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: 'Invalid webhook event' }, { status: 400 });
  }
  if (!FULFILLMENT_EVENTS.has(event.type)) {
    return Response.json({ received: true, ignored: true });
  }

  const sessionId = event.data?.object?.id;
  if (typeof sessionId !== 'string' || !/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
    return Response.json({ error: 'Invalid checkout session' }, { status: 400 });
  }

  try {
    const session = await stripeRequest(STRIPE_SECRET_KEY, 'GET', `/checkout/sessions/${sessionId}`);
    if (session.payment_status !== 'paid') {
      // Some payment methods complete asynchronously. Their success event will follow.
      return Response.json({ received: true, paymentState: 'processing' });
    }

    const order = await loadOrderSnapshot(context, sessionId);
    const expectedAmount = isValidOrderSnapshot(order)
      ? order.amount_total
      : null;
    const validPayment = isValidOrderSnapshot(order) && session.currency === 'usd' &&
      Number.isSafeInteger(session.amount_total) && session.amount_total === expectedAmount;
    if (!validPayment || !order.customerDetails) {
      throw new Error('Paid session has no valid order and fulfillment details');
    }

    await fulfillPaidOrder(context, session, order);
    return Response.json({ received: true, fulfilled: true });
  } catch (err) {
    console.error(JSON.stringify({
      message: 'stripe_fulfillment_webhook_failed',
      eventId: event.id || null,
      sessionId,
      retryable: true,
      errorName: err?.name || 'Error',
      notificationStatus: err instanceof NotificationDeliveryError ? err.result?.notificationStatus : undefined
    }));
    // Stripe retries failed deliveries. Notification claims make concurrent or repeated
    // event deliveries safe while failed recipients remain eligible for another attempt.
    return Response.json({ error: 'Fulfillment will retry' }, { status: 500 });
  }
}
