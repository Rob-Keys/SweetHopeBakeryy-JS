// GET /api/get-data?tableName=products&key=optional
// Reads a JSON table from Cloudflare KV.
// KV binding name: "kv-db"

import { checkAuth } from './_auth.js';

const ALLOWED_TABLES = new Set(['products', 'home_page', 'about_page', 'contact_page']);
const KV_BINDING = 'kv-db';

function isValidTableName(name) {
  return ALLOWED_TABLES.has(name);
}

function getKv(context) {
  return context.env[KV_BINDING];
}

export async function onRequestGet(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: `KV binding "${KV_BINDING}" not configured` }, { status: 500 });
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
      return Response.json(item);
    }

    return Response.json(data);
  } catch (err) {
    console.error('get-data error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
