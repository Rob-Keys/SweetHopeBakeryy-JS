// KV helper utilities for Cloudflare Pages Functions.

const ALLOWED_TABLES = new Set(['products', 'home_page', 'about_page', 'contact_page']);
const KV_BINDING = 'kv-db';

export function getKv(context) {
  return context.env[KV_BINDING];
}

/**
 * Read a JSON table from KV. A missing key is an empty table; read errors or
 * values with an unexpected shape must not be treated as empty, since callers
 * may write the returned array back and erase the existing table.
 * @param {object} kv
 * @param {string} tableName
 * @returns {Promise<Array>}
 */
export async function readTable(kv, tableName) {
  const value = await kv.get(`data/${tableName}.json`, 'json');
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`Stored ${tableName} table is not an array`);
  }
  return value;
}

export function isValidTableName(name) {
  return ALLOWED_TABLES.has(name);
}
