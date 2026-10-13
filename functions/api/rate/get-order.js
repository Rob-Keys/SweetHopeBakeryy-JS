// GET /api/rate/get-order?session_id=...
// Returns only the public order summary. Fulfillment PII stays server-side.

import { loadOrderSnapshot } from '../_orders.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!/^cs_(?:test|live)_[A-Za-z0-9]+$/.test(sessionId || '')) {
    return Response.json({ error: 'Valid session_id is required' }, { status: 400 });
  }

  try {
    const data = await loadOrderSnapshot(context, sessionId);
    if (!data) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }
    return Response.json({
      cart: data.cart,
      cart_total: Number(data.cart_total)
    });
  } catch (err) {
    console.error('get-order error:', err);
    return Response.json({ error: 'Unable to load order' }, { status: 500 });
  }
}
