import assert from 'node:assert/strict';
import { test } from 'node:test';
import { onRequestPost } from '../functions/api/codex/tasks.js';
import { onRequestGet as readTask } from '../functions/api/codex/tasks/[taskId].js';
import { onRequestGet as readStatus } from '../functions/api/codex/agent/status.js';
import { signJWT } from '../functions/api/_jwt.js';

const secret = 'luna-api-test-signing-key';
async function context({ id = crypto.randomUUID(), authorized = true, files = [], prompt = 'Update title' } = {}) {
  const calls = [];
  const body = new FormData();
  body.set('taskId', id);
  body.set('prompt', prompt);
  for (const file of files) body.append('attachments', file);
  const token = await signJWT({ sub: 'admin' }, secret);
  return {
    request: new Request('https://site.test/api/codex/tasks', { method: 'POST', body, headers: authorized ? { Authorization: `Bearer ${token}` } : {} }),
    params: { taskId: id },
    env: {
      JWT_SECRET: secret, CODEX_AGENT_RELAY_TOKEN: 'private-relay-secret',
      CODEX_AGENT_RELAY: { idFromName: name => name, get: () => ({ fetch: async request => { calls.push(request); return Response.json({ taskId: id }, { status: 202 }); } }) }
    }, calls, id
  };
}

test('all Luna Pages endpoints require authentication before accessing the relay', async () => {
  for (const endpoint of [onRequestPost, readTask, readStatus]) {
    const ctx = await context({ authorized: false });
    assert.equal((await endpoint(ctx)).status, 401);
    assert.equal(ctx.calls.length, 0);
  }
});

test('Pages preserves the browser task ID and private attachments when forwarding', async () => {
  const ctx = await context({ files: [new File(['reference'], 'photo.png', { type: 'image/png' })] });
  const result = await onRequestPost(ctx);
  assert.equal(result.status, 202);
  assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(ctx.calls.length, 1);
  const forwarded = ctx.calls[0];
  assert.equal(forwarded.headers.get('Authorization'), 'Bearer private-relay-secret');
  const body = await forwarded.formData();
  assert.equal(body.get('taskId'), ctx.id);
  assert.equal(body.get('prompt'), 'Update title');
  assert.equal(await body.get('attachments').text(), 'reference');
});

test('Pages rejects invalid IDs, prompts and files without forwarding them', async () => {
  for (const options of [{ id: 'invalid' }, { prompt: ' ' }, { prompt: 'a'.repeat(12001) }, { files: [new File([], 'empty.png')] }, { files: Array.from({ length: 6 }, () => new File(['x'], 'file.png')) }]) {
    const ctx = await context(options);
    assert.equal((await onRequestPost(ctx)).status, 400);
    assert.equal(ctx.calls.length, 0);
  }
});
