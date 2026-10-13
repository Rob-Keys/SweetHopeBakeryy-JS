// POST /api/rate/verify-checkout
// Verifies Stripe payment and runs the same idempotent fulfillment path as the webhook.

import { stripeRequest } from '../_stripe.js';
import { loadOrderSnapshot } from '../_orders.js';
import { fulfillPaidOrder, NotificationDeliveryError } from '../_fulfillment.js';

function isValidOrderSnapshot(snapshot) {
  return Boolean(
    snapshot && Array.isArray(snapshot.cartLines) && snapshot.cartLines.length > 0 &&
    snapshot.cart && typeof snapshot.cart === 'object' && !Array.isArray(snapshot.cart) &&
    Number.isSafeInteger(snapshot.amount_total) && snapshot.amount_total > 0 &&
    Number.isFinite(Number(snapshot.cart_total)) && Number(snapshot.cart_total) > 0
  );
}

function logVerificationFailure(stage, sessionId, err, request) {
  console.error(JSON.stringify({
    message: 'verify_checkout_failed',
    stage,
    sessionId: sessionId || null,
    rayId: request.headers.get('cf-ray') || null,
    errorName: err?.name || 'Error',
    error: String(err?.message || 'Unknown error').slice(0, 300)
  }));
}

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ paymentState: 'temporarily_unavailable', error: 'Checkout is temporarily unavailable' }, { status: 503 });
  }

  let sessionId;
  let stage = 'parse_request';
  try {
    const body = await context.request.json();
    sessionId = String(body?.session_id || '');
    if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return Response.json({ paymentState: 'unpaid', error: 'Invalid checkout session' }, { status: 400 });
    }

    stage = 'retrieve_stripe_session';
    const session = await stripeRequest(STRIPE_SECRET_KEY, 'GET', `/checkout/sessions/${sessionId}`);
    const paid = session.payment_status === 'paid';
    if (!paid) {
      return Response.json({
        success: false,
        paymentState: session.status === 'expired' ? 'unpaid' : 'processing',
        customerEmail: session.customer_details?.email || null
      });
    }

    stage = 'load_order_snapshot';
    const order = await loadOrderSnapshot(context, sessionId);
    const validOrder = isValidOrderSnapshot(order);
    const expectedAmount = validOrder ? order.amount_total : null;
    const amountMatches = validOrder && session.currency === 'usd' &&
      Number.isSafeInteger(session.amount_total) && session.amount_total === expectedAmount;
    if (!amountMatches || !order.customerDetails) {
      console.error(JSON.stringify({
        message: 'paid_checkout_needs_review',
        sessionId,
        hasOrderSnapshot: validOrder,
        hasFulfillmentDetails: !!order?.customerDetails,
        amountMatches
      }));
      return Response.json({
        success: false,
        paymentState: 'review',
        customerEmail: session.customer_details?.email || order?.customerDetails?.customer_email || null
      });
    }

    let delivery = {
      customerEmailSent: false,
      notificationStatus: 'pending'
    };
    stage = 'fulfill_paid_order';
    try {
      delivery = await fulfillPaidOrder(context, session, order);
    } catch (err) {
      if (err instanceof NotificationDeliveryError) delivery = err.result;
      logVerificationFailure(stage, sessionId, err, context.request);
    }

    return Response.json({
      success: true,
      paymentState: 'paid',
      customerEmail: session.customer_details?.email || order.customerDetails.customer_email,
      customerEmailSent: delivery.customerEmailSent,
      notificationStatus: delivery.notificationStatus,
      cart: order.cart,
      cartTotal: Number(order.cart_total)
    });
  } catch (err) {
    logVerificationFailure(stage, sessionId, err, context.request);
    const paymentState = stage === 'retrieve_stripe_session' || stage === 'load_order_snapshot'
      ? 'temporarily_unavailable'
      : 'temporarily_unavailable';
    return Response.json({ paymentState, error: 'Payment status is temporarily unavailable' }, { status: 503 });
  }
}
