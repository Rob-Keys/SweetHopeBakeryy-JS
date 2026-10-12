// GET /api/rate/get-order?session_id=...
// Returns the non-PII order snapshot used by the return page.

import { loadOrderSnapshot } from '../_orders.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) {
    return Response.json({ error: 'session_id is required' }, { status: 400 });
  }

  try {
    const data = await loadOrderSnapshot(context, sessionId);
    if (!data) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }
    return Response.json(data);
  } catch (err) {
    console.error('get-order error:', err);
    return Response.json({ error: 'Unable to load order' }, { status: 500 });
  }
}
