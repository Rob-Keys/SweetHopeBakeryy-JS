import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TABLES = ['products', 'home_page', 'about_page', 'contact_page'];

const {
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  CF_KV_NAMESPACE_ID
} = process.env;

if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !CF_KV_NAMESPACE_ID) {
  console.error('Missing required env vars: CF_API_TOKEN, CF_ACCOUNT_ID, CF_KV_NAMESPACE_ID');
  process.exit(1);
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}` +
  `/storage/kv/namespaces/${CF_KV_NAMESPACE_ID}/values`;

const headers = {
  'Authorization': `Bearer ${CF_API_TOKEN}`
};

async function fetchJson(key) {
  const res = await fetch(`${baseUrl}/${encodeURIComponent(key)}`, { headers });
  if (!res.ok) {
    throw new Error(`KV fetch failed for ${key}: ${res.status}`);
  }
  return res.json();
}

async function main() {
  const outDir = path.resolve('src/data');
  await mkdir(outDir, { recursive: true });

  for (const table of TABLES) {
    const key = `data/${table}.json`;
    try {
      const data = await fetchJson(key);
      const outPath = path.join(outDir, `${table}.json`);
      await writeFile(outPath, JSON.stringify(data, null, 2));
      console.log(`Wrote ${outPath}`);
    } catch (err) {
      console.error(`Failed to pull ${table}: ${err.message}`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
