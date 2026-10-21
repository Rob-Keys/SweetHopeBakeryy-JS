#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;

function readEnvValue(contents, key) {
  const line = contents.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') || '';
}

try {
  const [envContents, authContents] = await Promise.all([
    readFile(join(root, '.env'), 'utf8'),
    readFile(join(process.env.HOME || '', '.codex', 'auth.json'), 'utf8')
  ]);
  const relayToken = readEnvValue(envContents, 'CODEX_AGENT_RELAY_TOKEN');
  const relayUrl = readEnvValue(envContents, 'CODEX_AGENT_RELAY_URL');
  const auth = JSON.parse(authContents);
  if (!relayToken || !/^wss:\/\//.test(relayUrl)) {
    throw new Error('The ignored .env file needs CODEX_AGENT_RELAY_TOKEN and CODEX_AGENT_RELAY_URL.');
  }
  if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token || !auth.tokens?.refresh_token || !auth.tokens?.account_id) {
    throw new Error('Sign in to Codex with ChatGPT first; the local auth file does not contain a ChatGPT session.');
  }

  const relay = new URL(relayUrl);
  relay.protocol = 'https:';
  relay.pathname = '/internal/credentials';
  relay.search = '';
  const response = await fetch(relay, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${relayToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ auth }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `The relay rejected the credential refresh (${response.status}).`);
  }
  console.log('Refreshed Luna’s stored ChatGPT sign-in.');
} catch (error) {
  console.error(error?.message || 'Could not refresh Luna’s ChatGPT sign-in.');
  process.exitCode = 1;
}
