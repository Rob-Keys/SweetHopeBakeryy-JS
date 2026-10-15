import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { test } from 'node:test';
import { Miniflare, Log, LogLevel } from 'miniflare';

const script = new URL('../scripts/codex-cloud-agent.mjs', import.meta.url).pathname;
const oldToken = 'old-secret-token-for-runner-test';
const newToken = 'refreshed-secret-token-for-runner-test';

async function fixture(t, { push = false, uploadFails = false, disconnect = false, dropAck = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'luna-runner-test-'));
  const checkout = join(root, 'checkout');
  const remote = join(root, 'remote.git');
  const bin = join(root, 'bin');
  const temp = join(root, 'temp');
  await Promise.all([mkdir(checkout), mkdir(bin), mkdir(temp)]);
  const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', remote]);
  git(['init', '-b', 'main']);
  git(['config', 'user.name', 'Fixture']);
  git(['config', 'user.email', 'fixture@example.test']);
  await writeFile(join(checkout, 'title.txt'), 'Original title\n');
  git(['add', 'title.txt']);
  git(['commit', '-m', 'Initial fixture']);
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-u', 'origin', 'main']);
  const baseline = git(['rev-parse', 'HEAD']);
  const taskId = crypto.randomUUID();
  const mf = new Miniflare({
    modules: true,
    script: `
      const events = [];
      let socket;
      export class RunnerRelay { async fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/events') return Response.json(events);
        if (path === '/disconnect') { events.push({ type: 'server-disconnect', socketExists: Boolean(socket) }); socket?.close(1008, 'Test disconnect'); return Response.json({ ok: true }); }
        if (path.endsWith('/attachments')) return Response.json({ attachments: [] });
        const pair = new WebSocketPair();
        socket = pair[1]; socket.accept();
        socket.addEventListener('message', event => {
          const data = JSON.parse(event.data);
          events.push(data);
          if (data.type === 'authenticate') {
            socket.send(JSON.stringify({ type: 'authenticated', taskId: data.taskId }));
            socket.send(JSON.stringify({ type: 'task', taskId: data.taskId, prompt: 'Update the title', deadlineAt: Date.now() + 720000 }));
          }
          if (data.type === 'credential-request') socket.send(JSON.stringify({ type: 'credentials', taskId: data.taskId, auth: { auth_mode: 'chatgpt', tokens: { access_token: '${oldToken}', refresh_token: '${oldToken}', account_id: 'account' } } }));
          if (data.type === 'credential-update') socket.send(JSON.stringify({ type: 'credential-update-ack', taskId: data.taskId, updateId: data.updateId }));
          if (data.type === 'task-update' && (!${dropAck} || events.filter(event => event.type === 'task-update').length > 1)) socket.send(JSON.stringify({ type: 'task-update-ack', taskId: data.taskId, updateId: data.updateId }));
        });
        return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'luna' } });
      } }
      export default { fetch(request, env) { return env.TEST.get(env.TEST.idFromName('runner')).fetch(request); } };`,
    durableObjects: { TEST: { className: 'RunnerRelay', useSQLite: true } },
    compatibilityDate: '2026-07-30', log: new Log(LogLevel.ERROR)
  });
  t.after(() => mf.dispose());
  const url = await mf.ready;
  const authMarker = join(root, 'saved-auth.json');
  const traceMarker = join(root, 'uploaded-trace.jsonl');
  const childMarker = join(root, 'codex-started');
  const stoppedMarker = join(root, 'codex-stopped');
  await writeFile(join(bin, 'codex'), `#!${process.execPath}
    const fs = require('node:fs');
    const cp = require('node:child_process');
    const path = require('node:path');
    process.stdin.resume();
    process.stdin.on('end', () => {
      fs.writeFileSync(${JSON.stringify(childMarker)}, String(process.pid));
      const authPath = path.join(process.env.CODEX_HOME, 'auth.json');
      const auth = JSON.parse(fs.readFileSync(authPath));
      auth.tokens.access_token = ${JSON.stringify(newToken)};
      auth.tokens.refresh_token = ${JSON.stringify(newToken)};
      fs.writeFileSync(authPath, JSON.stringify(auth));
      fs.writeFileSync(${JSON.stringify(authMarker)}, JSON.stringify(auth));
      console.log(JSON.stringify({ event: 'trace', old: ${JSON.stringify(oldToken)}, refreshed: ${JSON.stringify(newToken)} }));
      ${push ? `fs.writeFileSync('title.txt', 'Changed title\\n'); cp.execFileSync('git', ['add', 'title.txt']); cp.execFileSync('git', ['commit', '-m', 'Update title']); cp.execFileSync('git', ['push', 'origin', 'HEAD:main']);` : ''}
      ${disconnect ? `process.on('SIGTERM', () => { fs.writeFileSync(${JSON.stringify(stoppedMarker)}, 'stopped'); process.exit(1); }); setInterval(() => {}, 1000);` : `fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], 'Updated title.');`}
    });
  `, { mode: 0o700 });
  await writeFile(join(bin, 'aws'), `#!${process.execPath}
    require('node:fs').copyFileSync(process.argv[4], ${JSON.stringify(traceMarker)});
    process.exit(${uploadFails ? 1 : 0});
  `, { mode: 0o700 });
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env, PATH: [bin, dirname(process.execPath), process.env.PATH].join(delimiter),
      GITHUB_WORKSPACE: checkout, RUNNER_TEMP: temp, INPUT_TASK_ID: taskId,
      CODEX_AGENT_RELAY_URL: new URL('/agent', url).href.replace(/^http/, 'ws'),
      CODEX_AGENT_RELAY_TOKEN: 'test-runner-relay-token', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1',
      AWS_ACCESS_KEY_ID: 'fake-aws-access-token', AWS_SECRET_ACCESS_KEY: 'fake-aws-secret-token', AWS_SESSION_TOKEN: 'fake-aws-session-token'
    }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const completed = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Runner timed out: ${stderr}`)); }, 15000);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stderr }); });
  });
  t.after(async () => {
    child.kill('SIGKILL');
    try {
      const pid = Number(await readFile(childMarker, 'utf8'));
      if (Number.isInteger(pid) && pid > 1) process.kill(-pid, 'SIGKILL');
    } catch { /* Child already exited. */ }
    await rm(root, { force: true, recursive: true });
  });
  const events = async () => (await mf.dispatchFetch(new URL('/events', url))).json();
  return { root, temp, taskId, git, baseline, completed, events, traceMarker, authMarker, childMarker, stoppedMarker, disconnect: () => mf.dispatchFetch(new URL('/disconnect', url)) };
}

async function waitForFile(path) {
  for (let index = 0; index < 200; index += 1) {
    try { return await readFile(path, 'utf8'); } catch { await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  assert.fail(`File was not created: ${path}`);
}

test('runner saves refreshed credentials, redacts new tokens and waits for a result acknowledgment', async t => {
  const fixtureData = await fixture(t, { dropAck: true });
  const { code, stderr } = await fixtureData.completed;
  assert.equal(code, 0, stderr);
  const events = await fixtureData.events();
  const updates = events.filter(event => event.type === 'task-update');
  assert.equal(updates.length, 2);
  assert.equal(updates[0].updateId, updates[1].updateId);
  assert.equal(updates[0].status, 'complete');
  assert.equal(events.find(event => event.type === 'credential-update').auth.tokens.access_token, newToken);
  const trace = await readFile(fixtureData.traceMarker, 'utf8');
  assert.ok(!trace.includes(oldToken) && !trace.includes(newToken));
  assert.equal((await readdir(fixtureData.temp)).length, 0);
});

test('a trace upload failure after a verified push still reports the pushed commit', async t => {
  const fixtureData = await fixture(t, { push: true, uploadFails: true });
  const { code, stderr } = await fixtureData.completed;
  assert.equal(code, 1);
  assert.match(stderr, /"phase":"trace"/);
  const result = (await fixtureData.events()).find(event => event.type === 'task-update');
  assert.equal(result.status, 'pushed');
  assert.notEqual(result.commit, fixtureData.baseline);
  assert.equal(result.commit, fixtureData.git(['rev-parse', 'HEAD']));
  assert.match(result.message, /later runner check failed/);
});

test('relay disconnect terminates an active Codex process and exits unsuccessfully', async t => {
  const fixtureData = await fixture(t, { disconnect: true });
  await waitForFile(fixtureData.childMarker);
  const disconnection = await fixtureData.disconnect();
  assert.equal(disconnection.status, 200, await disconnection.text());
  const { code } = await fixtureData.completed;
  assert.equal(code, 1);
  assert.equal(await waitForFile(fixtureData.stoppedMarker), 'stopped');
  assert.equal((await readdir(fixtureData.temp)).length, 0);
});
