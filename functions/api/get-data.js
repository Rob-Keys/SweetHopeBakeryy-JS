// GET /api/get-data?tableName=products&key=optional
// Reads a JSON table (or a single item by key) from Cloudflare KV.
// Public (no auth required) — edge-cached via Cache-Control + purged on writes.

import { getKv, isValidTableName } from './_kv.js';

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=3600'
};

export async function onRequestGet(context) {
  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: 'KV binding not configured' }, { status: 500 });
  }

  try {
    const url = new URL(context.request.url);
    const tableName = url.searchParams.get('tableName');
    const partitionValue = url.searchParams.get('key');

    if (!isValidTableName(tableName)) {
      return Response.json({ error: 'Invalid table name' }, { status: 400 });
    }

    const kvKey = `data/${tableName}.json`;
    const data = (await kv.get(kvKey, 'json')) || [];

    if (partitionValue !== null) {
      const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
      const item = Array.isArray(data)
        ? data.find(d => String(d[partitionKey]) === String(partitionValue)) || null
        : null;
      return Response.json(item, { headers: CACHE_HEADERS });
    }

    return Response.json(data, { headers: CACHE_HEADERS });
  } catch (err) {
    console.error('get-data error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
