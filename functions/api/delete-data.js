// POST /api/delete-data
// Removes an item from a JSON table in Cloudflare KV.

import { checkAuth } from './_auth.js';
import { getKv, isValidTableName } from './_kv.js';
import { queueDeployHook } from './_deploy.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: 'KV binding not configured' }, { status: 500 });
  }

  try {
    const { tableName, key: partitionValue } = await context.request.json();
    if (!isValidTableName(tableName)) {
      return Response.json({ error: 'Invalid table name' }, { status: 400 });
    }

    const kvKey = `data/${tableName}.json`;

    // Read current data
    let data = [];
    try {
      const existing = await kv.get(kvKey, 'json');
      if (Array.isArray(existing)) data = existing;
    } catch (err) {
      console.error('KV read error:', err);
    }

    // Determine partition key and filter out the item
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    data = data.filter(d => String(d[partitionKey]) !== String(partitionValue));

    // Write back
    await kv.put(kvKey, JSON.stringify(data));

    await queueDeployHook(context);

    return Response.json({ success: true });
  } catch (err) {
    console.error('delete-data error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
