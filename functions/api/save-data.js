// POST /api/save-data
// Upserts an item into a JSON table stored in Cloudflare KV.
// Reads the full array, replaces/append the item, then writes back.
// Partition key: `itemName` for products, `sectionIndex` for page tables.

import { checkAuth } from './_auth.js';
import { getKv, isValidTableName, readTable } from './_kv.js';
import { queueCachePurge } from './_deploy.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const kv = getKv(context);
  if (!kv) {
    return Response.json({ error: 'KV binding not configured' }, { status: 500 });
  }

  try {
    const { tableName, item, createOnly = false, previousKey = null } = await context.request.json();
    if (!isValidTableName(tableName)) {
      return Response.json({ error: 'Invalid table name' }, { status: 400 });
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return Response.json({ error: 'Invalid item' }, { status: 400 });
    }
    if (previousKey !== null && tableName !== 'products') {
      return Response.json({ error: 'Renaming is only supported for products.' }, { status: 400 });
    }

    const key = `data/${tableName}.json`;

    // Stop on read errors or corrupt table data; writing an empty fallback here
    // could replace the complete table with only the submitted item.
    const data = await readTable(kv, tableName);

    // Select the partition key based on the table shape.
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    let partitionValue = item[partitionKey];

    if (tableName === 'products') {
      if (typeof partitionValue !== 'string' || !partitionValue.trim()) {
        return Response.json({ error: 'Product name is required.' }, { status: 400 });
      }
      partitionValue = partitionValue.trim();
      item[partitionKey] = partitionValue;
    }

    // Section indexes are numeric sort positions. Normalize them before create-only
    // checks so values such as "01" and "1" cannot create ambiguous positions.
    if (createOnly && tableName !== 'products') {
      const numericIndex = Number(partitionValue);
      if (!Number.isInteger(numericIndex)) {
        return Response.json({ error: 'Section index must be a whole number.' }, { status: 400 });
      }
      if (tableName === 'contact_page' && numericIndex < 3) {
        return Response.json({ error: 'Contact page section indexes must be 3 or greater.' }, { status: 400 });
      }
      partitionValue = String(numericIndex);
      item[partitionKey] = partitionValue;
    }

    if (previousKey !== null) {
      if (typeof previousKey !== 'string' || !previousKey.trim()) {
        return Response.json({ error: 'Original product name is required.' }, { status: 400 });
      }
      const oldKey = previousKey.trim();
      const oldIndex = data.findIndex(d => String(d[partitionKey]) === oldKey);
      if (oldIndex < 0) {
        return Response.json({ error: 'Original product no longer exists.' }, { status: 404 });
      }
      if (oldKey !== partitionValue) {
        const duplicateIndex = data.findIndex(d => String(d[partitionKey]) === partitionValue);
        if (duplicateIndex >= 0 && duplicateIndex !== oldIndex) {
          return Response.json({ error: 'A product with this name already exists.' }, { status: 409 });
        }
      }
      // Replace the old record in the same KV write so readers never see both names.
      data[oldIndex] = item;
    } else {
      // Upsert: replace existing or append. Create-only section writes compare numeric
      // positions so legacy forms like "01" still collide with the canonical "1".
      const existingIndex = data.findIndex(d => createOnly && tableName !== 'products'
        ? Number(d[partitionKey]) === Number(partitionValue)
        : String(d[partitionKey]) === String(partitionValue));
      if (existingIndex >= 0) {
        if (createOnly) {
          const message = tableName === 'products'
            ? 'A product with this name already exists.'
            : 'A section with this index already exists.';
          return Response.json({ error: message }, { status: 409 });
        }
        data[existingIndex] = item;
      } else {
        data.push(item);
      }
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
