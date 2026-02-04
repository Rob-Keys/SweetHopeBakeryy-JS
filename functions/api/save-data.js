// POST /api/save-data
// Writes an item to a JSON table in Cloudflare KV.
// KV binding name: "kv-db"
//
// This function reads the current JSON array from KV, upserts the item, and writes it back.
// The partition key is 'itemName' for products and 'sectionIndex' for page tables.

import { checkAuth } from './_auth.js';

const ALLOWED_TABLES = new Set(['products', 'home_page', 'about_page', 'contact_page']);
const KV_BINDING = 'kv-db';

function isValidTableName(name) {
  return ALLOWED_TABLES.has(name);
}

function getKv(context) {
  return context.env[KV_BINDING];
}

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: `KV binding "${KV_BINDING}" not configured` }, { status: 500 });
  }

  try {
    const { tableName, item } = await context.request.json();
    if (!isValidTableName(tableName)) {
      return Response.json({ error: 'Invalid table name' }, { status: 400 });
    }

    const key = `data/${tableName}.json`;

    // Read current data
    let data = [];
    try {
      const existing = await kv.get(key, 'json');
      if (Array.isArray(existing)) data = existing;
    } catch (err) {
      console.error('KV read error:', err);
    }

    // Determine partition key
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    const partitionValue = item[partitionKey];

    // Upsert: replace existing or append
    const existingIndex = data.findIndex(d => String(d[partitionKey]) === String(partitionValue));
    if (existingIndex >= 0) {
      data[existingIndex] = item;
    } else {
      data.push(item);
    }

    // Write back
    await kv.put(key, JSON.stringify(data));

    const deployHook = context.env.PAGES_DEPLOY_HOOK_URL;
    if (deployHook) {
      context.waitUntil(fetch(deployHook, { method: 'POST' }).catch(() => {}));
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error('save-data error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
