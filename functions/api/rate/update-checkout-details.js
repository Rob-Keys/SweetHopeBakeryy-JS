// POST /api/rate/update-checkout-details
// Validates and persists fulfillment details on an unpaid order snapshot.

import { stripeRequest } from '../_stripe.js';
import { loadOrderSnapshot, saveOrderSnapshot } from '../_orders.js';
import { validateCustomerDetails } from '../_pickup-date.js';

function isValidOrderSnapshot(snapshot) {
  return Boolean(
    snapshot && Array.isArray(snapshot.cartLines) && snapshot.cartLines.length > 0 &&
    Number.isFinite(Number(snapshot.cart_total)) && Number(snapshot.cart_total) > 0
  );
}

function getExpectedAmount(snapshot) {
  return Number.isSafeInteger(snapshot.amount_total)
    ? snapshot.amount_total
    : Math.round(Number(snapshot.cart_total) * 100);
}

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Checkout is temporarily unavailable' }, { status: 503 });
  }

  let stage = 'parse_request';
  let sessionId;
  try {
    const body = await context.request.json();
    sessionId = String(body?.session_id || '');
    if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return Response.json({ error: 'Invalid checkout session' }, { status: 400 });
    }

    let customerDetails;
    try {
      customerDetails = validateCustomerDetails(body?.customerDetails);
    } catch (err) {
      return Response.json({ error: err.message }, { status: 400 });
    }

    stage = 'verify_open_stripe_session';
    const session = await stripeRequest(STRIPE_SECRET_KEY, 'GET', `/checkout/sessions/${sessionId}`);
    if (session.status !== 'open' || session.payment_status !== 'unpaid') {
      return Response.json({ error: 'This checkout session can no longer be updated' }, { status: 409 });
    }

    stage = 'load_order_snapshot';
    const order = await loadOrderSnapshot(context, sessionId);
    const expectedAmount = isValidOrderSnapshot(order) ? getExpectedAmount(order) : null;
    if (!isValidOrderSnapshot(order) || session.currency !== 'usd' || session.amount_total !== expectedAmount) {
      return Response.json({ error: 'Checkout order could not be validated' }, { status: 409 });
    }

    stage = 'save_fulfillment_details';
    await saveOrderSnapshot(context, sessionId, { ...order, amount_total: expectedAmount, customerDetails });
    return Response.json({ saved: true });
  } catch (err) {
    console.error(JSON.stringify({
      message: 'checkout_details_save_failed',
      stage,
      sessionId: sessionId || null,
      rayId: context.request.headers.get('cf-ray') || null,
      errorName: err?.name || 'Error',
      error: String(err?.message || 'Unknown error').slice(0, 300)
    }));
    return Response.json({ error: 'Unable to save order details. Please try again.' }, { status: 500 });
  }
}
