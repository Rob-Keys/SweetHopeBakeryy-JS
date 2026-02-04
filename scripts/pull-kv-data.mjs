import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TABLES = ['products', 'home_page', 'about_page', 'contact_page'];

const {
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_KV_NAMESPACE_ID,
  CF_API_TOKEN,
  CF_ACCOUNT_ID,
  CF_KV_NAMESPACE_ID
} = process.env;

const API_TOKEN = CLOUDFLARE_API_TOKEN || CF_API_TOKEN;
const ACCOUNT_ID = CLOUDFLARE_ACCOUNT_ID || CF_ACCOUNT_ID;
const KV_NAMESPACE_ID = CLOUDFLARE_KV_NAMESPACE_ID || CF_KV_NAMESPACE_ID;

const present = (value) => (value ? 'yes' : 'no');
console.log('[kv-pull] env present:', {
  CLOUDFLARE_API_TOKEN: present(CLOUDFLARE_API_TOKEN),
  CLOUDFLARE_ACCOUNT_ID: present(CLOUDFLARE_ACCOUNT_ID),
  CLOUDFLARE_KV_NAMESPACE_ID: present(CLOUDFLARE_KV_NAMESPACE_ID),
  CF_API_TOKEN: present(CF_API_TOKEN),
  CF_ACCOUNT_ID: present(CF_ACCOUNT_ID),
  CF_KV_NAMESPACE_ID: present(CF_KV_NAMESPACE_ID)
});

if (!API_TOKEN || !ACCOUNT_ID || !KV_NAMESPACE_ID) {
  console.error('Missing required env vars: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_KV_NAMESPACE_ID');
  process.exit(1);
}

const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}` +
  `/storage/kv/namespaces/${KV_NAMESPACE_ID}/values`;

const headers = {
  'Authorization': `Bearer ${API_TOKEN}`
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
    const key = `${table}.json`;
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
