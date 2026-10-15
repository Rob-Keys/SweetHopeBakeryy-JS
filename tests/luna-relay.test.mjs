import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Miniflare, Log, LogLevel, FormData } from 'miniflare';

const token = 'test-relay-token-with-enough-characters';
const auth = { auth_mode: 'chatgpt', tokens: { access_token: 'test-access-token-secret', refresh_token: 'test-refresh-token-secret', account_id: 'account' } };
const relaySource = await readFile(new URL('../codex-relay/index.js', import.meta.url), 'utf8');
const requestSource = await readFile(new URL('../codex-relay/task-request.js', import.meta.url), 'utf8');
const origin = 'https://relay.test';

async function fixture(t, dispatch = () => new Response(null, { status: 204 })) {
  const calls = [];
  const mf = new Miniflare({
    modules: [
      { type: 'ESModule', path: 'entry.js', contents: `
        import worker, { CodeAgentRelay } from './relay.js';
        export default worker;
        export class TestRelay extends CodeAgentRelay {
          constructor(ctx, env) {
            super(ctx, { ...env, LUNA_ATTACHMENTS: {
              put: (...args) => env.LUNA_ATTACHMENTS.put(...args),
              get: (...args) => env.LUNA_ATTACHMENTS.get(...args),
              delete: async key => {
                if (await ctx.storage.get('failDelete')) throw new Error('Temporary R2 outage');
                return env.LUNA_ATTACHMENTS.delete(key);
              }
            } });
          }
          async fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === '/internal/test/seed') { await this.ctx.storage.put(await request.json()); return Response.json({ ok: true }); }
            if (path === '/internal/test/state') return Response.json({ entries: [...await this.ctx.storage.list()], alarm: await this.ctx.storage.getAlarm() });
            if (path === '/internal/test/alarm') { await this.alarm(); return Response.json({ ok: true }); }
            return super.fetch(request);
          }
        }` },
      { type: 'ESModule', path: 'relay.js', contents: relaySource },
      { type: 'ESModule', path: 'task-request.js', contents: requestSource }
    ],
    compatibilityDate: '2026-07-30',
    durableObjects: { CODEX_AGENT_RELAY: { className: 'TestRelay', useSQLite: true } },
    r2Buckets: ['LUNA_ATTACHMENTS'],
    bindings: { CODEX_AGENT_RELAY_TOKEN: token, LUNA_GITHUB_ACTIONS_TOKEN: 'github-test', CODEX_SIWC_CREDENTIALS: JSON.stringify(auth) },
    outboundService: async request => {
      calls.push({ url: request.url, body: await request.text() });
      return dispatch(request);
    },
    log: new Log(LogLevel.ERROR)
  });
  t.after(() => mf.dispose());
  const request = (path, init = {}) => mf.dispatchFetch(`${origin}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  const state = async () => {
    const result = await (await request('/internal/test/state')).json();
    return { entries: Object.fromEntries(result.entries), alarm: result.alarm };
  };
  const seed = entries => request('/internal/test/seed', { method: 'POST', body: JSON.stringify(entries) });
  const start = (id = crypto.randomUUID(), prompt = 'Change the title', files = []) => {
    const body = new FormData();
    body.set('taskId', id);
    body.set('prompt', prompt);
    for (const file of files) body.append('attachments', file);
    return request('/internal/tasks', { method: 'POST', body });
  };
  const connect = async taskId => {
    const response = await request('/agent', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `luna, auth.${Buffer.from(token).toString('base64url')}` } });
    const socket = response.webSocket;
    socket.accept();
    const messages = [];
    socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
    socket.send(JSON.stringify({ type: 'authenticate', token, taskId, phase: 'agent', runId: '123' }));
    await until(() => messages.some(message => message.type === 'task'));
    t.after(() => socket.close());
    return { socket, messages };
  };
  return { request, state, seed, start, calls, connect, mf };
}

async function until(check) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for relay state');
}

test('relay reserves one task, retries idempotently, and validates changed requests', async t => {
  const { start, state, calls } = await fixture(t);
  const id = crypto.randomUUID();
  const initial = await start(id); assert.equal(initial.status, 202, await initial.text());
  assert.equal((await start(id)).status, 202);
  assert.equal(calls.length, 1);
  assert.equal((await start(id, 'Different change')).status, 409);
  assert.equal((await start()).status, 409);
  assert.equal((await state()).entries.currentTaskId, id);
});

test('overlapping submissions cannot dispatch two runners', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { start, calls } = await fixture(t, async () => { await gate; return new Response(null, { status: 204 }); });
  const first = start();
  await until(() => calls.length === 1);
  const second = await start();
  assert.equal(second.status, 409);
  release();
  assert.equal((await first).status, 202);
  assert.equal(calls.length, 1);
});

test('retention cleanup cannot expire a newer running task or lose its deadline', async t => {
  const { start, seed, state, request } = await fixture(t);
  const oldId = crypto.randomUUID();
  await seed({ [`task:${oldId}`]: { taskId: oldId, status: 'complete', retainUntil: Date.now() - 1000 } });
  const id = crypto.randomUUID();
  await start(id);
  await request('/internal/test/alarm');
  const result = await state();
  assert.equal(result.entries[`task:${id}`].status, 'running');
  assert.equal(result.entries[`task:${oldId}`], undefined);
  assert.equal(result.alarm, result.entries[`task:${id}`].deadlineAt);
});

test('deadline expiry marks work uncertain, cleans private files, and cancels the workflow', async t => {
  const { start, seed, state, request, connect, calls, mf } = await fixture(t);
  const id = crypto.randomUUID();
  await start(id, 'Use the reference', [new File(['private image'], 'reference.png', { type: 'image/png' })]);
  await connect(id);
  const task = (await state()).entries[`task:${id}`];
  await seed({ [`task:${id}`]: { ...task, deadlineAt: Date.now() - 1000 } });
  await request('/internal/test/alarm');
  const result = (await state()).entries[`task:${id}`];
  assert.equal(result.status, 'uncertain');
  assert.equal(result.prompt, undefined);
  assert.deepEqual(result.attachments, []);
  assert.equal(await (await mf.getR2Bucket('LUNA_ATTACHMENTS')).get(`tasks/${id}/0`), null);
  assert.ok(calls.some(call => call.url.endsWith('/123/cancel')));
});

test('runner results are durable, redacted, acknowledged, and safe to retransmit', async t => {
  const { start, connect, state, request } = await fixture(t);
  const id = crypto.randomUUID();
  await start(id);
  const { socket, messages } = await connect(id);
  socket.send(JSON.stringify({ type: 'credential-request', taskId: id }));
  await until(() => messages.some(message => message.type === 'credentials'));
  const update = { type: 'task-update', taskId: id, updateId: 'saved-result', status: 'pushed', commit: 'a'.repeat(40), summary: `Updated title ${auth.tokens.access_token} ${token}` };
  socket.send(JSON.stringify(update));
  await until(() => messages.some(message => message.type === 'task-update-ack'));
  assert.equal((await state()).entries[`task:${id}`].status, 'pushed');
  socket.send(JSON.stringify(update));
  await until(() => messages.filter(message => message.type === 'task-update-ack').length === 2);
  const result = await (await request(`/internal/tasks/${id}`)).json();
  assert.equal(result.prompt, undefined);
  assert.equal(result.runnerSessionId, undefined);
  assert.equal(result.requestHash, undefined);
  assert.equal(result.summary, 'Updated title [redacted] [redacted]');
});

test('workflow setup failures are reported immediately and cannot overwrite terminal results', async t => {
  const { start, request, state } = await fixture(t);
  const id = crypto.randomUUID();
  await start(id);
  const report = body => request(`/internal/tasks/${id}/run`, { method: 'POST', body: JSON.stringify(body) });
  assert.equal((await report({ runId: '123' })).status, 200);
  assert.equal((await report({ runId: '456' })).status, 409);
  assert.equal((await report({ runId: '123', status: 'failed' })).status, 200);
  assert.equal((await state()).entries[`task:${id}`].status, 'failed');
  await report({ runId: '123', status: 'failed' });
  assert.equal((await state()).entries[`task:${id}`].status, 'failed');
});

test('invalid bodies, empty files and oversized requests are rejected before dispatch', async t => {
  const { start, request, calls } = await fixture(t);
  assert.equal((await start('------------------------------------')).status, 400);
  assert.equal((await start(crypto.randomUUID(), 'Change', [new File([], 'empty.png')])).status, 400);
  assert.equal((await start(crypto.randomUUID(), 'Change', [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png')])).status, 400);
  const oversized = new FormData();
  oversized.append('attachments', new File([new Uint8Array(26 * 1024 * 1024 + 1)], 'huge.png'));
  const tooLarge = await request('/internal/tasks', { method: 'POST', body: oversized });
  assert.equal(tooLarge.status, 413);
  assert.equal(calls.length, 0);
});

test('failed attachment deletes are retried without expiring another running request', async t => {
  const { start, seed, state, connect, request } = await fixture(t);
  const id = crypto.randomUUID();
  await start(id, 'Use image', [new File(['image'], 'image.png')]);
  const { socket, messages } = await connect(id);
  await seed({ failDelete: true });
  socket.send(JSON.stringify({ type: 'task-update', taskId: id, updateId: 'cleanup', status: 'complete' }));
  await until(async () => Boolean((await state()).entries[`task:${id}`]?.attachmentCleanupAt));
  assert.ok(messages.some(message => message.type === 'task-update-ack'));
  const nextId = crypto.randomUUID();
  await start(nextId);
  const old = (await state()).entries[`task:${id}`];
  await seed({ failDelete: false, [`task:${id}`]: { ...old, attachmentCleanupAt: Date.now() - 1 } });
  await request('/internal/test/alarm');
  const result = await state();
  assert.deepEqual(result.entries[`task:${id}`].attachments, []);
  assert.equal(result.entries[`task:${nextId}`].status, 'running');
  assert.equal(result.alarm, result.entries[`task:${nextId}`].deadlineAt);
});

test('unauthenticated upgrades and malformed WebSocket messages are rejected', async t => {
  const { request, start, connect } = await fixture(t);
  assert.equal((await request('/agent', { headers: { Upgrade: 'websocket' } })).status, 401);
  const id = crypto.randomUUID();
  await start(id);
  const { socket } = await connect(id);
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
  socket.send('null');
  assert.equal((await closed).code, 1008);
});

test('a second runner cannot replace an authenticated session or run the request twice', async t => {
  const { request, start, connect } = await fixture(t);
  const id = crypto.randomUUID();
  await start(id);
  await connect(id);
  const response = await request('/agent', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `luna, auth.${Buffer.from(token).toString('base64url')}` } });
  const second = response.webSocket;
  second.accept();
  const closed = new Promise(resolve => second.addEventListener('close', resolve, { once: true }));
  second.send(JSON.stringify({ type: 'authenticate', token, taskId: id, phase: 'agent', runId: '123' }));
  assert.equal((await closed).code, 1008);
});
