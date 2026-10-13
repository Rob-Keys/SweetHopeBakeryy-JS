#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateKvChanges, hashJson } from './luna-kv-data.mjs';

const relayToken = process.env.CODEX_AGENT_RELAY_TOKEN;
const relayUrl = process.env.CODEX_AGENT_RELAY_URL;
const taskId = process.env.INPUT_TASK_ID;
const artifactPath = resolve(process.env.LUNA_ARTIFACT_DIR || '');
const summaryPath = join(artifactPath, 'summary.txt');
const kvChangesPath = join(artifactPath, 'kv-changes.json');
const kvBaselinePath = join(artifactPath, 'kv-baseline.json');
const relayHttpUrl = relayUrl?.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/agent\/?$/, '').replace(/\/$/, '');
const cloudflareToken = process.env.LUNA_CLOUDFLARE_API_TOKEN;
const cloudflareAccountId = process.env.LUNA_CLOUDFLARE_ACCOUNT_ID;
const cloudflareNamespaceId = process.env.LUNA_CLOUDFLARE_KV_NAMESPACE_ID;
const cloudflareZoneId = process.env.LUNA_CLOUDFLARE_ZONE_ID;
let activeLease;

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, '[redacted credential]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/gi, 'Bearer [redacted credential]');
}

if (!relayToken || !relayUrl || !/^[0-9a-f-]{36}$/i.test(taskId || '') || !process.env.LUNA_ARTIFACT_DIR) {
  throw new Error('The trusted KV publisher is missing its task, artifact, or relay configuration.');
}

async function relayAction(action, data = {}) {
  const response = await fetch(`${relayHttpUrl}/internal/tasks/${encodeURIComponent(taskId)}/publish-lease`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json', ...(data.leaseId ? { 'X-Luna-Publish-Lease': data.leaseId } : {}) },
    body: JSON.stringify({ action, ...data })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Luna relay rejected ${action} (${response.status}).`);
  return result;
}

async function reportTask(status, message, summary) {
  return new Promise((resolveReport, rejectReport) => {
    const socket = new WebSocket(relayUrl);
    const timer = setTimeout(() => {
      socket.close(1008, 'Status report timed out');
      rejectReport(new Error('The relay did not confirm the publish result.'));
    }, 10000);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'authenticate', token: relayToken, taskId, phase: 'finalize', runId: process.env.GITHUB_RUN_ID })));
    socket.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (data.type !== 'authenticated' || data.phase !== 'finalize' || data.taskId !== taskId) return;
      socket.send(JSON.stringify({ type: 'task-update', taskId, status, message, summary }));
      clearTimeout(timer);
      socket.close(1000, 'Publish result reported');
      resolveReport();
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      rejectReport(new Error('Could not connect to the Luna relay to report the publish result.'));
    });
  });
}

function containsCredential(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text) ||
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/.test(text) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/i.test(text);
}

async function validateKvArtifact() {
  let kvOperations = [];
  let kvBaseline = {};
  const kvArtifact = await readFile(kvChangesPath, 'utf8').catch(() => null);
  const baselineArtifact = await readFile(kvBaselinePath, 'utf8').catch(() => null);
  if ((kvArtifact === null) !== (baselineArtifact === null)) throw new Error('The KV change artifact is incomplete.');
  if (kvArtifact !== null) {
    if (Buffer.byteLength(kvArtifact) > 1024 * 1024) throw new Error('The KV change artifact exceeds the 1 MB limit.');
    if (containsCredential(kvArtifact)) throw new Error('The KV change artifact appears to contain a credential; it was not applied.');
    kvOperations = validateKvChanges(JSON.parse(kvArtifact));
    kvBaseline = JSON.parse(baselineArtifact);
    for (const operation of kvOperations) {
      if (!/^[0-9a-f]{64}$/i.test(kvBaseline[operation.tableName] || '')) throw new Error(`The baseline hash for ${operation.tableName} is missing.`);
    }
  }
  if (!kvOperations.length) throw new Error('The KV publisher was started without a KV change artifact.');
  return { kvOperations, kvBaseline };
}

async function cloudflareApi(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cloudflareToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }
  });
  if (!response.ok) throw new Error(`Cloudflare rejected a KV operation (${response.status}).`);
  return response;
}

async function applyKvChanges(operations, baselineHashes) {
  if (!cloudflareToken || !cloudflareAccountId || !cloudflareNamespaceId || !cloudflareZoneId) {
    throw new Error('The trusted publisher is missing its scoped Cloudflare KV settings.');
  }
  const valueUrl = table => `/accounts/${encodeURIComponent(cloudflareAccountId)}/storage/kv/namespaces/${encodeURIComponent(cloudflareNamespaceId)}/values/${encodeURIComponent(`data/${table}.json`)}`;
  const originals = new Map();
  const tables = new Map();
  for (const table of new Set(operations.map(operation => operation.tableName))) {
    const response = await cloudflareApi(valueUrl(table));
    let value;
    try { value = await response.json(); } catch { throw new Error(`The live ${table} KV value is not valid JSON.`); }
    if (!Array.isArray(value)) throw new Error(`The live ${table} KV value is not a JSON array.`);
    if (hashJson(value) !== baselineHashes[table]) throw new Error(`The live ${table} table changed while Luna was working. No KV changes were applied; please submit the request again.`);
    originals.set(table, value);
    tables.set(table, structuredClone(value));
  }
  for (const operation of operations) {
    const table = tables.get(operation.tableName);
    const partitionKey = operation.tableName === 'products' ? 'itemName' : 'sectionIndex';
    const index = table.findIndex(item => {
      if (operation.tableName === 'products') return String(item?.[partitionKey]) === operation.key;
      const existingKey = item?.[partitionKey];
      return (typeof existingKey === 'number' || (typeof existingKey === 'string' && existingKey.trim() !== '')) &&
        Number.isSafeInteger(Number(existingKey)) && Number(existingKey) === Number(operation.key);
    });
    if (operation.action === 'delete') {
      if (index < 0) throw new Error(`The requested ${operation.tableName} item ${operation.key} no longer exists.`);
      if (operation.tableName === 'contact_page') {
        const sortedSections = [...table].sort((a, b) => Number(a?.sectionIndex) - Number(b?.sectionIndex));
        const requiredIndex = sortedSections.findIndex(item => item === table[index]);
        if (requiredIndex >= 0 && requiredIndex < 3) {
          throw new Error('The first three contact sections are required and cannot be removed.');
        }
      }
      table.splice(index, 1);
    } else if (index < 0) table.push(operation.item);
    else table[index] = operation.item;
  }
  const written = [];
  let attempting;
  try {
    for (const [table, value] of tables) {
      attempting = table;
      const response = await cloudflareApi(valueUrl(table), { method: 'PUT', body: JSON.stringify(value) });
      const result = await response.json().catch(() => ({}));
      if (result.success !== true) throw new Error(`Cloudflare could not update the ${table} table.`);
      written.push(table);
      attempting = undefined;
    }
  } catch (error) {
    const rollbackTables = [...new Set([...written, ...(attempting ? [attempting] : [])])].reverse();
    for (const table of rollbackTables) {
      await cloudflareApi(valueUrl(table), { method: 'PUT', body: JSON.stringify(originals.get(table)) }).catch(() => {});
    }
    await cloudflareApi(`/zones/${encodeURIComponent(cloudflareZoneId)}/purge_cache`, { method: 'POST', body: JSON.stringify({ purge_everything: true }) }).catch(() => {});
    throw error;
  }
  try {
    const purgeResponse = await cloudflareApi(`/zones/${encodeURIComponent(cloudflareZoneId)}/purge_cache`, { method: 'POST', body: JSON.stringify({ purge_everything: true }) });
    const purgeResult = await purgeResponse.json().catch(() => ({}));
    return purgeResult.success !== true ? 'KV values were updated, but the CDN cache purge did not succeed.' : '';
  } catch {
    return 'KV values were updated, but the CDN cache purge did not succeed.';
  }
}

async function publishKvChanges({ kvOperations, kvBaseline }, summary) {
  const lease = await relayAction('claim');
  activeLease = lease;
  await relayAction('validate', { leaseId: lease.leaseId });
  const warning = await applyKvChanges(kvOperations, kvBaseline);
  const details = `Updated ${kvOperations.length} requested KV change${kvOperations.length === 1 ? '' : 's'}.${warning ? ` ${warning}` : ''}`;
  let reportError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await relayAction('complete', { leaseId: lease.leaseId, summary: `${redactSecrets(summary)}\n\n${details}` });
      reportError = null;
      break;
    } catch (error) {
      reportError = error;
      await new Promise(resolveWait => setTimeout(resolveWait, 1000 * (attempt + 1)));
    }
  }
  if (reportError) throw new Error(`KV updates were applied, but the relay could not record completion: ${reportError.message}`);
  activeLease = null;
  console.log(details);
}

try {
  const [summary, result] = await Promise.all([
    readFile(summaryPath, 'utf8').catch(() => 'Luna finished the request.'),
    validateKvArtifact()
  ]);
  await publishKvChanges(result, summary);
} catch (error) {
  const message = redactSecrets(error?.message || error).slice(0, 4000);
  try {
    if (activeLease) await relayAction('failed', { leaseId: activeLease.leaseId, message });
    else await reportTask('failed', 'Luna could not publish the requested KV change.', message);
  } catch { /* The relay expiry will preserve the pending task outcome. */ }
  console.error(message);
  process.exitCode = 1;
}
