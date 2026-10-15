#!/usr/bin/env node

const relayToken = process.env.CODEX_AGENT_RELAY_TOKEN;
const relayUrl = process.env.CODEX_AGENT_RELAY_URL;
const taskId = process.env.INPUT_TASK_ID;
const runId = process.env.GITHUB_RUN_ID;
const relayHttpUrl = relayUrl?.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/agent\/?$/, '').replace(/\/$/, '');

if (!relayToken || !relayUrl || !/^[0-9a-f-]{36}$/i.test(taskId || '') || !/^\d{1,20}$/.test(runId || '')) {
  throw new Error('The Luna workflow-run reporter is missing its task or relay settings.');
}

const response = await fetch(`${relayHttpUrl}/internal/tasks/${encodeURIComponent(taskId)}/run`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${relayToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ runId, ...(process.argv.includes('--failed') ? { status: 'failed' } : {}) }),
  signal: AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error(`The Luna relay rejected this workflow run (${response.status}).`);
