#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const relayToken = process.env.CODEX_AGENT_RELAY_TOKEN;
const relayUrl = process.env.CODEX_AGENT_RELAY_URL;
const pushToken = process.env.LUNA_GITHUB_PUSH_TOKEN;
const taskId = process.env.INPUT_TASK_ID;
const repoPath = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const artifactPath = resolve(process.env.LUNA_ARTIFACT_DIR || '');
const repositoryUrl = 'https://github.com/Rob-Keys/SweetHopeBakeryy-JS.git';
const summaryPath = join(artifactPath, 'summary.txt');
const patchPath = join(artifactPath, 'change.patch');
const basePath = join(artifactPath, 'base.txt');

function redactSecrets(value) {
  return String(value ?? '')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, '[redacted credential]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/gi, 'Bearer [redacted credential]');
}

if (!relayToken || !relayUrl || !pushToken || !/^[0-9a-f-]{36}$/i.test(taskId || '') || !process.env.LUNA_ARTIFACT_DIR) {
  throw new Error('The isolated publisher is missing its task, artifact, relay, or push configuration.');
}

function git(args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolveGit, rejectGit) => {
    const child = spawn('git', args, { cwd: repoPath, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); rejectGit(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolveGit(stdout.trim());
      else rejectGit(new Error((stderr || stdout || `git ${args[0]} failed with ${code}`).slice(-3000)));
    });
  });
}

async function relayAction(action, data = {}) {
  const response = await fetch(`${relayUrl.replace(/\/$/, '')}/internal/tasks/${encodeURIComponent(taskId)}/publish-lease`, {
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

function protectedPath(path) {
  return path.startsWith('.github/') || path.startsWith('codex-relay/') ||
    path.startsWith('scripts/codex-') || path === 'scripts/setup-luna-cloud.mjs' ||
    path === 'scripts/publish-luna-cloud.mjs' || path === 'scripts/report-luna-run.mjs' || path === 'wrangler.toml' ||
    path === '.env' || path.startsWith('.env.') || path === '.dev.vars' || /\.(?:pem|key|p12|pfx)$/i.test(path) ||
    path === 'functions/api/_auth.js' || path === 'functions/api/_jwt.js' ||
    path === 'functions/api/_stripe.js' || path === 'functions/api/_orders.js' || path.startsWith('functions/api/rate/') ||
    path.startsWith('src/js/stripe/');
}

function containsCredential(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(text) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(text) ||
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/.test(text) ||
    /\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/i.test(text);
}

async function validatePatch() {
  const patch = await readFile(patchPath);
  if (patch.length > 5 * 1024 * 1024) throw new Error('The requested change exceeds the 5 MB publish limit.');
  const base = (await readFile(basePath, 'utf8')).trim();
  if (!/^[0-9a-f]{40}$/i.test(base)) throw new Error('The editing job did not provide a valid base commit.');
  await git(['fetch', '--quiet', 'origin', 'main']);
  if (await git(['rev-parse', 'HEAD']) !== base || await git(['rev-parse', 'origin/main']) !== base) {
    throw new Error('main changed while Luna was working. No changes were published; please submit the request again.');
  }
  if (await git(['status', '--porcelain'])) throw new Error('The isolated publisher checkout is not clean.');
  await git(['apply', '--index', '--binary', '--', patchPath]);
  await git(['diff', '--cached', '--check']);
  const changed = (await git(['diff', '--cached', '--name-only'])).split('\n').filter(Boolean);
  const protectedFile = changed.find(protectedPath);
  if (protectedFile) throw new Error(`This change touches a protected publishing or security file (${protectedFile}) and needs human review.`);
  for (const file of changed) {
    const content = await git(['show', `:${file}`]);
    if (containsCredential(content)) throw new Error(`The change appears to contain a credential in ${file}; it was not published.`);
  }
  for (const file of changed.filter(file => /\.(?:m?js|cjs)$/.test(file))) await git(['show', `:${file}`]).then(source => {
    return new Promise((resolveCheck, rejectCheck) => {
      const child = spawn(process.execPath, ['--check', '-'], { cwd: repoPath, stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', rejectCheck);
      child.on('close', code => code === 0 ? resolveCheck() : rejectCheck(new Error(`${file}: ${stderr.slice(-2000)}`)));
      child.stdin.end(source);
    });
  });
  return changed;
}

async function publishChanges(changed, summary) {
  if (!changed.length) {
    await reportTask('complete', 'Luna finished without source changes.', redactSecrets(summary || 'No source changes were needed.'));
    return;
  }
  const lease = await relayAction('claim');
  await relayAction('validate', { leaseId: lease.leaseId });
  await git(['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Luna Cloud Agent', '-c', 'user.email=luna-cloud-agent@users.noreply.github.com', 'commit', '-m', 'Apply Luna customization']);
  const commit = await git(['rev-parse', '--short=7', 'HEAD']);
  await relayAction('push-started', { leaseId: lease.leaseId, commit });
  await relayAction('validate', { leaseId: lease.leaseId });
  const auth = Buffer.from(`x-access-token:${pushToken}`).toString('base64');
  await git([
    '-c', `remote.origin.url=${repositoryUrl}`,
    '-c', 'core.hooksPath=/dev/null',
    '-c', `http.https://github.com/.extraheader=AUTHORIZATION: basic ${auth}`,
    'push', 'origin', 'HEAD:main'
  ], { timeoutMs: 30000 });
  let reportError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await relayAction('pushed', { leaseId: lease.leaseId, commit, summary: `${redactSecrets(summary)}\n\nPushed commit ${commit}.` });
      reportError = null;
      break;
    } catch (error) {
      reportError = error;
      await new Promise(resolveWait => setTimeout(resolveWait, 1000 * (attempt + 1)));
    }
  }
  if (reportError) throw new Error(`Pushed commit ${commit}, but the relay could not record the pushed outcome: ${reportError.message}`);
  console.log(`Pushed commit ${commit}; the Pages deployment has not been verified.`);
}

try {
  const [summary, changed] = await Promise.all([
    readFile(summaryPath, 'utf8').catch(() => 'Luna finished the request.'),
    validatePatch()
  ]);
  await publishChanges(changed, summary);
} catch (error) {
  const message = redactSecrets(error?.message || error).slice(0, 4000);
  try { await reportTask('failed', 'Luna could not publish the requested change.', message); } catch { /* The relay records an uncertain push separately when a push was started. */ }
  console.error(message);
  process.exitCode = 1;
}
