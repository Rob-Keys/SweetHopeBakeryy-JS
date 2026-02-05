// POST /api/save-data
// Upserts an item into a JSON table stored in Cloudflare KV.
// Reads the full array, replaces/append the item, then writes back.
// Partition key: `itemName` for products, `sectionIndex` for page tables.

import { checkAuth } from './_auth.js';
import { getKv, isValidTableName } from './_kv.js';
import { queueCachePurge } from './_deploy.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: 'KV binding not configured' }, { status: 500 });
  }

  try {
    const { tableName, item } = await context.request.json();
    if (!isValidTableName(tableName)) {
      return Response.json({ error: 'Invalid table name' }, { status: 400 });
    }

    const key = `data/${tableName}.json`;

    // Read current data (best-effort).
    let data = [];
    try {
      const existing = await kv.get(key, 'json');
      if (Array.isArray(existing)) data = existing;
    } catch (err) {
      console.error('KV read error:', err);
    }

    // Select the partition key based on the table shape.
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    const partitionValue = item[partitionKey];

    // Upsert: replace existing or append.
    const existingIndex = data.findIndex(d => String(d[partitionKey]) === String(partitionValue));
    if (existingIndex >= 0) {
      data[existingIndex] = item;
    } else {
      data.push(item);
    }

    // Persist the updated table.
    await kv.put(key, JSON.stringify(data));

    queueCachePurge(context);

    return Response.json({ success: true });
  } catch (err) {
    console.error('save-data error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
