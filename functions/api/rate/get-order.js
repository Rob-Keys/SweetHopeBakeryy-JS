// GET /api/rate/get-order?session_id=...
// Returns a short-lived, non-PII order snapshot for the return page

import { getKv } from '../_kv.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sessionId = url.searchParams.get('session_id');
  if (!sessionId) {
    return Response.json({ error: 'session_id is required' }, { status: 400 });
  }

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: 'KV binding not available' }, { status: 500 });
  }

  const data = await kv.get(`orders/${sessionId}`, 'json');
  if (!data) {
    return Response.json({ error: 'Order not found' }, { status: 404 });
  }

  return Response.json(data);
}
