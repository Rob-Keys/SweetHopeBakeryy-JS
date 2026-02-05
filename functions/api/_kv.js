// KV helper utilities for Cloudflare Pages Functions.

const ALLOWED_TABLES = new Set(['products', 'home_page', 'about_page', 'contact_page']);
const KV_BINDING = 'kv-db';

export function getKv(context) {
  return context.env[KV_BINDING];
}

export function isValidTableName(name) {
  return ALLOWED_TABLES.has(name);
}
