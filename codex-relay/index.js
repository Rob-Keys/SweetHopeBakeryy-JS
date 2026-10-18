import { readTaskForm } from './task-request.js';
import { commitContentChange } from './content-commit.js';

const MAX_PROMPT_LENGTH = 12000;
const TASK_RETENTION_MS = 15 * 60 * 1000;
const TASK_TIMEOUT_MS = 12 * 60 * 1000;
const TASK_START_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = ['complete', 'pushed', 'uncertain', 'failed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 25 * 1024 * 1024;
const GITHUB_REPOSITORY = 'Rob-Keys/SweetHopeBakeryy-JS';
const GITHUB_WORKFLOW = 'luna-agent.yml';

function validCodexAuth(auth) {
  const tokens = auth?.tokens;
  return auth?.auth_mode === 'chatgpt' &&
    typeof tokens?.access_token === 'string' && tokens.access_token.length > 0 && tokens.access_token.length <= 12000 &&
    typeof tokens?.refresh_token === 'string' && tokens.refresh_token.length > 0 && tokens.refresh_token.length <= 12000 &&
    typeof tokens?.account_id === 'string' && tokens.account_id.length > 0 && tokens.account_id.length <= 200 &&
    (!tokens.id_token || (typeof tokens.id_token === 'string' && tokens.id_token.length <= 12000));
}

async function sameSecret(provided, expected) {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided || '')),
    crypto.subtle.digest('SHA-256', encoder.encode(expected || ''))
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/agent' && !url.pathname.startsWith('/internal/')) return new Response('Not found', { status: 404 });
    const id = env.CODEX_AGENT_RELAY.idFromName('sweet-hope-bakery-codex-agent');
    return env.CODEX_AGENT_RELAY.get(id).fetch(request);
  }
};

export class CodeAgentRelay {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.contentQueue = Promise.resolve();
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/agent' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      // Authenticate the upgrade too, rather than retaining arbitrary public sockets.
      const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(value => value.trim());
      const expected = `auth.${btoa(this.env.CODEX_AGENT_RELAY_TOKEN || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      if (!this.env.CODEX_AGENT_RELAY_TOKEN || !protocols.includes('luna') || !await sameSecret(protocols.find(value => value.startsWith('auth.')), expected)) {
        return new Response('Unauthorized', { status: 401 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], ['agent']);
      return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': 'luna' } });
    }

    const denied = await this.authorize(request);
    if (denied) return denied;
    if (url.pathname === '/internal/status' && request.method === 'GET') return this.status();
    if (url.pathname === '/internal/content' && request.method === 'POST') return this.contentChange(request);
    if (url.pathname === '/internal/tasks' && request.method === 'POST') return this.startTask(request);
    const attachmentListMatch = url.pathname.match(/^\/internal\/tasks\/([0-9a-f-]{36})\/attachments$/i);
    if (attachmentListMatch && request.method === 'GET') return this.readAttachments(attachmentListMatch[1]);
    const attachmentMatch = url.pathname.match(/^\/internal\/tasks\/([0-9a-f-]{36})\/attachments\/(\d+)$/i);
    if (attachmentMatch && request.method === 'GET') return this.readAttachment(attachmentMatch[1], Number(attachmentMatch[2]));
    const taskMatch = url.pathname.match(/^\/internal\/tasks\/([0-9a-f-]{36})$/i);
    if (taskMatch && request.method === 'GET') return this.readTask(taskMatch[1]);
    const runMatch = url.pathname.match(/^\/internal\/tasks\/([0-9a-f-]{36})\/run$/i);
    if (runMatch && request.method === 'POST') return this.recordWorkflowRun(request, runMatch[1]);
    return new Response('Not found', { status: 404 });
  }

  async authorize(request) {
    const expected = this.env.CODEX_AGENT_RELAY_TOKEN;
    const provided = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!expected) return Response.json({ error: 'Luna cloud runner is not configured.' }, { status: 503 });
    if (!await sameSecret(provided, expected)) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    return null;
  }

  async contentChange(request) {
    let change;
    try {
      change = await request.json();
    } catch {
      return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
    }
    if (!this.env.LUNA_GITHUB_ACTIONS_TOKEN) {
      return Response.json({ success: false, error: 'GitHub content access is not configured.' }, { status: 503 });
    }

    const task = this.contentQueue.then(() => commitContentChange(this.env.LUNA_GITHUB_ACTIONS_TOKEN, change));
    this.contentQueue = task.then(() => undefined, () => undefined);
    try {
      return await task;
    } catch (error) {
      this.log('content_commit_failed', { status: error?.status || 502 });
      return Response.json({ success: false, error: error?.message || 'GitHub content commit failed with an unknown error.' }, { status: 502 });
    }
  }

  log(event, fields = {}) {
    console.log(JSON.stringify({ service: 'luna-relay', event, ...fields }));
  }

  async redactTaskText(value) {
    let text = String(value ?? '');
    const auth = await this.ctx.storage.get('codexAuth');
    for (const secret of [this.env.CODEX_AGENT_RELAY_TOKEN, this.env.LUNA_GITHUB_ACTIONS_TOKEN, auth?.tokens?.access_token, auth?.tokens?.refresh_token, auth?.tokens?.id_token]) {
      if (typeof secret === 'string' && secret.length >= 16) text = text.replaceAll(secret, '[redacted]');
    }
    return text
      .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[redacted private key]')
      .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})\b/g, '[redacted credential]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{32,}={0,2}/gi, 'Bearer [redacted credential]');
  }

  async status() {
    const taskId = await this.ctx.storage.get('currentTaskId');
    const task = taskId ? await this.ctx.storage.get(`task:${taskId}`) : null;
    const configured = Boolean(
      this.env.LUNA_GITHUB_ACTIONS_TOKEN &&
      this.env.CODEX_AGENT_RELAY_TOKEN &&
      await this.getCodexAuth()
    );
    return Response.json({ configured, attachmentsConfigured: Boolean(this.env.LUNA_ATTACHMENTS), busy: task?.status === 'running', taskId: task?.taskId || null });
  }

  async getCodexAuth() {
    let auth = await this.ctx.storage.get('codexAuth');
    if (validCodexAuth(auth)) return auth;
    try { auth = JSON.parse(this.env.CODEX_SIWC_CREDENTIALS || 'null'); } catch { return null; }
    return validCodexAuth(auth) ? auth : null;
  }

  async startTask(request) {
    let form;
    try { form = await readTaskForm(request); } catch (error) { return Response.json({ error: error.message }, { status: error.status || 400 }); }
    const prompt = typeof form.get('prompt') === 'string' ? form.get('prompt').trim() : '';
    if (!prompt) return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
    if (prompt.length > MAX_PROMPT_LENGTH) return Response.json({ error: `Prompt must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
    const taskId = typeof form.get('taskId') === 'string' ? form.get('taskId') : '';
    if (!UUID.test(taskId)) return Response.json({ error: 'Invalid Luna task ID.' }, { status: 400 });
    const files = form.getAll('attachments');
    if (files.some(file => !(file instanceof File) || file.size === 0)) return Response.json({ error: 'Attachments must be non-empty files.' }, { status: 400 });
    if (files.length > MAX_ATTACHMENT_COUNT) return Response.json({ error: `Attach no more than ${MAX_ATTACHMENT_COUNT} files.` }, { status: 400 });
    if (files.some(file => file.size > MAX_ATTACHMENT_SIZE)) return Response.json({ error: 'Each attachment must be 10 MB or smaller.' }, { status: 400 });
    if (files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_TOTAL) return Response.json({ error: 'Attachments must total 25 MB or less.' }, { status: 400 });
    if (files.length && !this.env.LUNA_ATTACHMENTS) return Response.json({ error: 'Private attachment storage is not configured yet.' }, { status: 503 });
    if (!this.env.LUNA_GITHUB_ACTIONS_TOKEN) return Response.json({ error: 'Luna cloud runner is not configured.' }, { status: 503 });
    if (!await this.getCodexAuth()) {
      return Response.json({ error: 'Luna ChatGPT sign-in is not configured.' }, { status: 503 });
    }

    const attachments = files.map((file, index) => ({
      key: `tasks/${taskId}/${index}`,
      filename: file.name.replaceAll('\\', '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || `attachment-${index + 1}`,
      contentType: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream',
      size: file.size
    }));
    const fingerprint = JSON.stringify({ prompt, files: await Promise.all(files.map(async (file) => ({
      name: file.name, type: file.type, size: file.size,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    }))) });
    const requestHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))), byte => byte.toString(16).padStart(2, '0')).join('');
    const task = {
      taskId, prompt, requestHash, attachments, status: 'running',
      message: "Creating Luna's environment…",
      createdAt: new Date().toISOString(),
      deadlineAt: Date.now() + TASK_START_TIMEOUT_MS
    };
    // Reserve the task before any R2 or GitHub I/O can yield to another request.
    const existing = await this.ctx.storage.transaction(async storage => {
      const saved = await storage.get(`task:${taskId}`);
      if (saved) return saved;
      const previousId = await storage.get('currentTaskId');
      const previous = previousId ? await storage.get(`task:${previousId}`) : null;
      if (previous?.status === 'running') return { busy: true };
      await storage.put({ currentTaskId: taskId, [`task:${taskId}`]: task });
      return null;
    });
    if (existing?.busy) return Response.json({ error: 'Luna is already working on a request. Wait for it to finish.' }, { status: 409 });
    if (existing) {
      if (existing.requestHash !== requestHash) return Response.json({ error: 'This task ID was already used for a different request.' }, { status: 409 });
      return Response.json({ taskId, status: existing.status }, { status: 202 });
    }
    await this.scheduleCleanup();

    try {
      for (const [index, file] of files.entries()) {
        const { key, filename, contentType } = attachments[index];
        await this.env.LUNA_ATTACHMENTS.put(key, file.stream(), {
          httpMetadata: { contentType }, customMetadata: { filename, size: String(file.size) }
        });
      }
      const latest = await this.ctx.storage.get(`task:${taskId}`);
      if (latest?.status !== 'running') {
        await this.deleteTaskAttachments({ ...task, attachments });
        return Response.json({ taskId, status: latest?.status || 'failed' }, { status: 202 });
      }
      let response;
      try { response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.env.LUNA_GITHUB_ACTIONS_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'SweetHopeBakery-Luna-Relay',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main', inputs: { taskId: task.taskId } })
      }); } catch {
        this.log('workflow_dispatch_unconfirmed', { taskId });
        return Response.json({ taskId, status: 'running' }, { status: 202 });
      }
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      this.log('workflow_dispatched', { taskId: task.taskId });
    } catch (error) {
      this.log('workflow_dispatch_failed', { taskId });
      const latest = await this.ctx.storage.get(`task:${taskId}`);
      if (latest?.status === 'running' && !latest.runnerSessionId) {
        delete latest.prompt;
        await this.saveTask({ ...latest, status: 'failed',
          message: 'Luna could not prepare or start its temporary runner. Please try a new request.',
          summary: (await this.redactTaskText(error?.message || error)).slice(0, 300),
          updatedAt: new Date().toISOString(), retainUntil: Date.now() + TASK_RETENTION_MS });
      }
      await this.deleteTaskAttachments(task);
      await this.scheduleCleanup();
    }

    const saved = await this.ctx.storage.get(`task:${taskId}`);
    return Response.json({ taskId, status: saved?.status || 'running' }, { status: 202 });
  }

  async readAttachments(taskId) {
    const task = await this.ctx.storage.get(`task:${taskId}`);
    if (!task || task.status !== 'running') return Response.json({ error: 'The Luna task is no longer active.' }, { status: 404 });
    return Response.json({
      attachments: (task.attachments || []).map(({ filename, contentType, size }, index) => ({ index, filename, contentType, size }))
    });
  }

  async readAttachment(taskId, index) {
    const task = await this.ctx.storage.get(`task:${taskId}`);
    const attachment = task?.attachments?.[index];
    if (!attachment || task.status !== 'running' || !this.env.LUNA_ATTACHMENTS) return Response.json({ error: 'Attachment not found.' }, { status: 404 });
    const object = await this.env.LUNA_ATTACHMENTS.get(attachment.key);
    if (!object) return Response.json({ error: 'Attachment not found.' }, { status: 404 });
    const headers = new Headers({
      'Content-Type': attachment.contentType,
      'Content-Length': String(attachment.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      'Cache-Control': 'private, no-store'
    });
    return new Response(object.body, { headers });
  }

  async deleteTaskAttachments(task) {
    if (!task) return;
    const failed = [];
    for (const attachment of task.attachments || []) {
      try {
        if (!this.env.LUNA_ATTACHMENTS) throw new Error('Attachment binding unavailable');
        await this.env.LUNA_ATTACHMENTS.delete(attachment.key);
      } catch { failed.push(attachment); }
    }
    // Never overwrite newer task state after an external storage operation.
    const latest = await this.ctx.storage.get(`task:${task.taskId}`);
    if (!latest) return;
    await this.saveTask({ ...latest, attachments: failed,
      attachmentCleanupAt: failed.length ? Date.now() + 60000 : null });
  }

  async readTask(taskId) {
    const task = await this.ctx.storage.get(`task:${taskId}`);
    if (!task || (task.retainUntil && Date.now() >= task.retainUntil)) {
      if (task) await this.scheduleCleanup();
      return Response.json({ error: 'Task not found.' }, { status: 404 });
    }
    const { prompt: _prompt, attachments: _attachments, requestHash: _hash, runnerSessionId: _session, ...publicTask } = task;
    return Response.json(publicTask);
  }

  async saveTask(task) {
    await this.ctx.storage.put(`task:${task.taskId}`, task);
  }

  async recordWorkflowRun(request, taskId) {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const currentId = await this.ctx.storage.get('currentTaskId');
    const task = await this.ctx.storage.get(`task:${taskId}`);
    if (currentId !== taskId || !task || !/^\d{1,20}$/.test(body?.runId || '')) {
      return Response.json({ error: 'The workflow run is not attached to an active Luna task.' }, { status: 409 });
    }
    const workflowRunUrl = `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${body.runId}`;
    if (task.workflowRunUrl && task.workflowRunUrl !== workflowRunUrl) return Response.json({ error: 'A different workflow already owns this task.' }, { status: 409 });
    if (task.status !== 'running') return Response.json({ recorded: true });
    if (body.status === 'failed') {
      delete task.prompt;
      await this.saveTask({ ...task, workflowRunUrl, status: task.runnerSessionId ? 'uncertain' : 'failed',
        message: task.runnerSessionId ? 'The workflow stopped before its result was confirmed. Check the run before retrying; changes may have been applied.' : 'Luna’s environment setup failed. Check the GitHub Actions run for details.',
        updatedAt: new Date().toISOString(), retainUntil: Date.now() + TASK_RETENTION_MS });
      await this.deleteTaskAttachments(task);
    } else {
      await this.saveTask({ ...task, workflowRunUrl,
        workflowDeadlineAt: task.workflowDeadlineAt || Date.now() + 14 * 60 * 1000 });
    }
    await this.scheduleCleanup();
    this.log('workflow_run_observed', { taskId, runId: body.runId });
    return Response.json({ recorded: true });
  }

  async webSocketMessage(socket, message) {
    let data;
    try {
      data = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
    } catch {
      socket.close(1008, 'Invalid message');
      return;
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) { socket.close(1008, 'Invalid message'); return; }

    let attachment;
    try { attachment = socket.deserializeAttachment() || {}; } catch { attachment = {}; }
    if (!attachment.authenticated) {
      // Finish crypto before reading the task; only storage operations may yield
      // while checking and claiming its single runner session.
      const tokenMatches = await sameSecret(data.token, this.env.CODEX_AGENT_RELAY_TOKEN);
      const currentId = await this.ctx.storage.get('currentTaskId');
      const task = currentId ? await this.ctx.storage.get(`task:${currentId}`) : null;
      if (
        data?.type !== 'authenticate' ||
        !tokenMatches ||
        typeof data.taskId !== 'string' ||
        task?.status !== 'running' ||
        task.taskId !== data.taskId ||
        data.phase !== 'agent' ||
        !task.prompt ||
        task.runnerSessionId ||
        task.deadlineAt <= Date.now() ||
        (task.workflowRunUrl && task.workflowRunUrl !== `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${data.runId}`)
      ) {
        socket.close(1008, 'Authentication required for an active task');
        return;
      }

      const sessionId = crypto.randomUUID();
      socket.serializeAttachment({ authenticated: true, sessionId, taskId: task.taskId, phase: data.phase });
      await this.ctx.storage.put('runnerSessionId', sessionId);
      const deadlineAt = Math.min(Date.now() + TASK_TIMEOUT_MS, task.workflowDeadlineAt || Infinity);
      await this.saveTask({
        ...task,
        runnerSessionId: sessionId,
        deadlineAt,
        message: 'Luna is working in a temporary cloud runner.',
        updatedAt: new Date().toISOString()
      });
      const taskUpdate = await this.ctx.storage.get(`task:${task.taskId}`);
      if (typeof data.runId === 'string' && /^\d{1,20}$/.test(data.runId)) {
        await this.saveTask({ ...taskUpdate, workflowRunUrl: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${data.runId}` });
        this.log('workflow_run_observed', { taskId: task.taskId, runId: data.runId });
      }
      await this.scheduleCleanup();
      socket.send(JSON.stringify({ type: 'authenticated', taskId: task.taskId, phase: 'agent' }));
      socket.send(JSON.stringify({ type: 'task', taskId: task.taskId, prompt: task.prompt, deadlineAt }));
      return;
    }

    const activeSessionId = await this.ctx.storage.get('runnerSessionId');
    if (attachment.sessionId !== activeSessionId) {
      socket.close(1001, 'Runner session replaced');
      return;
    }
    const currentId = await this.ctx.storage.get('currentTaskId');
    const task = currentId ? await this.ctx.storage.get(`task:${currentId}`) : null;
    if (!task || task.taskId !== attachment.taskId || data.taskId !== task.taskId) return;
    if (task.status !== 'running') {
      if (data.type === 'task-update' && data.updateId === task.resultUpdateId) socket.send(JSON.stringify({ type: 'task-update-ack', taskId: task.taskId, updateId: data.updateId }));
      return;
    }

    if (data?.type === 'credential-request') {
      let auth = await this.getCodexAuth();
      if (!validCodexAuth(auth)) {
        socket.send(JSON.stringify({ type: 'credential-error', taskId: task.taskId }));
      } else {
        let hostId = await this.ctx.storage.get('extAgentHostId');
        if (!hostId) {
          hostId = `urn:uuid:${crypto.randomUUID()}`;
          await this.ctx.storage.put('extAgentHostId', hostId);
        }
        auth = { ...auth, ext_agent_host_id: hostId };
        await this.ctx.storage.put('codexAuth', auth);
        socket.send(JSON.stringify({ type: 'credentials', taskId: task.taskId, auth }));
      }
      return;
    }

    if (data?.type === 'credential-update') {
      const auth = data.auth;
      if (validCodexAuth(auth)) {
        const hostId = await this.ctx.storage.get('extAgentHostId');
        await this.ctx.storage.put('codexAuth', { ...auth, ext_agent_host_id: hostId });
        if (typeof data.updateId === 'string') socket.send(JSON.stringify({ type: 'credential-update-ack', taskId: task.taskId, updateId: data.updateId }));
      }
      return;
    }

    if (data?.type === 'task-update') {
      const status = TERMINAL_STATUSES.includes(data.status) ? data.status : 'running';
      const updatedTask = {
        ...task,
        status,
        message: typeof data.message === 'string' ? (await this.redactTaskText(data.message)).slice(0, 500) : task.message,
        updatedAt: new Date().toISOString()
      };
      if (typeof data.summary === 'string') updatedTask.summary = (await this.redactTaskText(data.summary)).slice(0, 12000);
      if (status === 'pushed') {
        if (typeof data.commit !== 'string' || !/^[0-9a-f]{7,40}$/i.test(data.commit)) return;
        updatedTask.commit = data.commit;
      }
      if (TERMINAL_STATUSES.includes(status)) {
        delete updatedTask.prompt;
        updatedTask.retainUntil = Date.now() + TASK_RETENTION_MS;
        if (typeof data.updateId === 'string') updatedTask.resultUpdateId = data.updateId;
      }
      await this.saveTask(updatedTask);
      if (TERMINAL_STATUSES.includes(status)) {
        if (typeof data.updateId === 'string') socket.send(JSON.stringify({ type: 'task-update-ack', taskId: task.taskId, updateId: data.updateId }));
        await this.deleteTaskAttachments(updatedTask);
        await this.scheduleCleanup();
        this.log('task_terminal', { taskId: task.taskId, status });
      }
    }
  }

  async alarm() {
    const now = Date.now();
    const currentId = await this.ctx.storage.get('currentTaskId');
    const task = currentId ? await this.ctx.storage.get(`task:${currentId}`) : null;
    if (task?.status === 'running' && (task.deadlineAt || Date.parse(task.createdAt) + TASK_START_TIMEOUT_MS) <= now) {
      const { prompt: _prompt, ...expiredTask } = task;
      const failedTask = { ...expiredTask, status: task.runnerSessionId ? 'uncertain' : 'failed', message: task.runnerSessionId ? 'Luna’s runner exceeded its time limit. Check the workflow before retrying; changes may have been applied.' : 'Luna’s environment did not start before its time limit.', updatedAt: new Date().toISOString(), retainUntil: now + TASK_RETENTION_MS };
      await this.saveTask(failedTask);
      await this.deleteTaskAttachments(failedTask);
      this.log('task_expired', { taskId: task.taskId, workflowRunUrl: task.workflowRunUrl || null });
      for (const socket of this.ctx.getWebSockets()) {
        try {
          const attachment = socket.deserializeAttachment();
          if (attachment?.taskId === task.taskId) socket.close(1008, 'Luna task expired');
        } catch { /* Ignore sockets without an authenticated attachment. */ }
      }
      if (task.workflowRunUrl && this.env.LUNA_GITHUB_ACTIONS_TOKEN) {
        const runId = task.workflowRunUrl.split('/').pop();
        await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/runs/${runId}/cancel`, {
          method: 'POST', signal: AbortSignal.timeout(15000), headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.env.LUNA_GITHUB_ACTIONS_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SweetHopeBakery-Luna-Relay' }
        }).catch(() => {});
      }
    }
    await this.scheduleCleanup();
  }

  async scheduleCleanup() {
    const tasks = await this.ctx.storage.list({ prefix: 'task:' });
    const now = Date.now();
    let next = Infinity;
    for (const [key, task] of tasks) {
      if (task.status === 'running') {
        next = Math.min(next, task.deadlineAt || Date.parse(task.createdAt) + TASK_START_TIMEOUT_MS);
        continue;
      }
      if (task.attachments?.length && (!task.attachmentCleanupAt || task.attachmentCleanupAt <= now)) await this.deleteTaskAttachments(task);
      const latest = await this.ctx.storage.get(key);
      if (latest?.attachments?.length) next = Math.min(next, latest.attachmentCleanupAt);
      else if (latest?.retainUntil && latest.retainUntil <= now) {
        await this.ctx.storage.delete(key);
        if (await this.ctx.storage.get('currentTaskId') === task.taskId) await this.ctx.storage.delete('currentTaskId');
      } else if (latest?.retainUntil) next = Math.min(next, latest.retainUntil);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(Math.max(now + 1, next));
    else await this.ctx.storage.deleteAlarm();
  }

  async webSocketClose(socket) {
    try {
      const attachment = socket.deserializeAttachment();
      if (attachment?.sessionId !== await this.ctx.storage.get('runnerSessionId')) return;
      const task = await this.ctx.storage.get(`task:${attachment.taskId}`);
      if (task?.status === 'running' && task.taskId === attachment.taskId) return;
    } catch { /* Ignore a socket that did not authenticate. */ }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
}
