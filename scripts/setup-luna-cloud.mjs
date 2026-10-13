#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repo = 'Rob-Keys/SweetHopeBakeryy-JS';
const root = new URL('../', import.meta.url).pathname;

function readEnvValue(contents, key) {
  const line = contents.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '') || '';
}

function run(command, args, input) {
  const result = spawnSync(command, args, { cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.slice(0, 3).join(' ')} failed.`);
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this setup from an interactive terminal.');
  process.stdout.write(prompt);
  const input = process.stdin;
  const oldRawMode = input.isRaw;
  input.setRawMode(true);
  input.resume();
  let value = '';
  return await new Promise((resolve, reject) => {
    const finish = (error) => {
      input.off('data', onData);
      input.setRawMode(oldRawMode || false);
      process.stdout.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Setup cancelled.'));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 127 || byte === 8) value = value.slice(0, -1);
        else value += String.fromCharCode(byte);
      }
    };
    input.on('data', onData);
  });
}

try {
  const envContents = await readFile(join(root, '.env'), 'utf8');
  const relayToken = readEnvValue(envContents, 'CODEX_AGENT_RELAY_TOKEN');
  const relayUrl = readEnvValue(envContents, 'CODEX_AGENT_RELAY_URL');
  const authPath = join(process.env.HOME || '', '.codex', 'auth.json');
  const auth = JSON.parse(await readFile(authPath, 'utf8'));
  if (!relayToken || !/^wss:\/\//.test(relayUrl)) throw new Error('The ignored .env file needs CODEX_AGENT_RELAY_TOKEN and CODEX_AGENT_RELAY_URL.');
  if (auth.auth_mode !== 'chatgpt' || !auth.tokens?.access_token || !auth.tokens?.refresh_token || !auth.tokens?.account_id) {
    throw new Error('Sign in to Codex with ChatGPT first; the local auth file does not contain a ChatGPT session.');
  }

  const githubToken = await readHidden('Paste a fine-grained GitHub token scoped to this repository with Actions: write and Contents: write (input hidden): ');
  if (!githubToken.trim()) throw new Error('A repository-scoped GitHub Actions/contents token is required.');

  console.log('Saving the relay URL and relay token to GitHub Actions, then configuring Cloudflare secrets…');
  run('gh', ['secret', 'set', 'CODEX_AGENT_RELAY_TOKEN', '--repo', repo], relayToken);
  run('gh', ['secret', 'set', 'LUNA_GITHUB_PUSH_TOKEN', '--repo', repo], githubToken.trim());
  run('gh', ['variable', 'set', 'CODEX_AGENT_RELAY_URL', '--repo', repo, '--body', relayUrl]);
  run('npx', ['--yes', 'wrangler', 'secret', 'put', 'LUNA_GITHUB_ACTIONS_TOKEN', '--config', 'codex-relay/wrangler.toml'], githubToken.trim());
  run('npx', ['--yes', 'wrangler', 'secret', 'put', 'CODEX_AGENT_RELAY_TOKEN', '--config', 'codex-relay/wrangler.toml'], relayToken);
  run('npx', ['--yes', 'wrangler', 'secret', 'put', 'CODEX_SIWC_CREDENTIALS', '--config', 'codex-relay/wrangler.toml'], JSON.stringify(auth));
  console.log('Luna cloud credentials are configured. Deploy the relay Worker and Pages project to activate the cloud runner.');
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
