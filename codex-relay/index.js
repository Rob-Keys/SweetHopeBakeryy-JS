const MAX_PROMPT_LENGTH = 12000;
const TASK_RETENTION_MS = 15 * 60 * 1000;
const TASK_TIMEOUT_MS = 12 * 60 * 1000;
const TASK_START_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 25 * 1024 * 1024;
const GITHUB_REPOSITORY = 'Rob-Keys/SweetHopeBakeryy-JS';
const GITHUB_WORKFLOW = 'luna-agent.yml';

function validCodexAuth(auth) {
  const tokens = auth?.tokens;
  return auth?.auth_mode === 'chatgpt' &&
    typeof tokens?.access_token === 'string' && tokens.access_token.length <= 12000 &&
    typeof tokens?.refresh_token === 'string' && tokens.refresh_token.length <= 12000 &&
    typeof tokens?.account_id === 'string' && tokens.account_id.length <= 200 &&
    (!tokens.id_token || (typeof tokens.id_token === 'string' && tokens.id_token.length <= 12000));
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
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/agent' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], ['agent']);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    const denied = this.authorize(request);
    if (denied) return denied;
    if (url.pathname === '/internal/status' && request.method === 'GET') return this.status();
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

  authorize(request) {
    const expected = this.env.CODEX_AGENT_RELAY_TOKEN;
    const provided = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!expected) return Response.json({ error: 'Luna cloud runner is not configured.' }, { status: 503 });
    if (provided !== expected) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    return null;
  }

  log(event, fields = {}) {
    console.log(JSON.stringify({ service: 'luna-relay', event, ...fields }));
  }

  async redactTaskText(value) {
    let text = String(value ?? '');
    const auth = await this.ctx.storage.get('codexAuth');
    for (const secret of [auth?.tokens?.access_token, auth?.tokens?.refresh_token, auth?.tokens?.id_token]) {
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
      ((await this.ctx.storage.get('codexAuth'))?.tokens?.refresh_token || this.env.CODEX_SIWC_CREDENTIALS)
    );
    return Response.json({ configured, attachmentsConfigured: Boolean(this.env.LUNA_ATTACHMENTS), busy: task?.status === 'running', taskId: task?.taskId || null });
  }

  async startTask(request) {
    let form;
    try { form = await request.formData(); } catch { return Response.json({ error: 'Invalid request body.' }, { status: 400 }); }
    const prompt = typeof form.get('prompt') === 'string' ? form.get('prompt').trim() : '';
    if (!prompt) return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
    if (prompt.length > MAX_PROMPT_LENGTH) return Response.json({ error: `Prompt must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
    const taskId = typeof form.get('taskId') === 'string' ? form.get('taskId') : '';
    if (!/^[0-9a-f-]{36}$/i.test(taskId)) return Response.json({ error: 'Invalid Luna task ID.' }, { status: 400 });
    const files = form.getAll('attachments').filter(value => value instanceof File && value.size > 0);
    if (files.length > MAX_ATTACHMENT_COUNT) return Response.json({ error: `Attach no more than ${MAX_ATTACHMENT_COUNT} files.` }, { status: 400 });
    if (files.some(file => file.size > MAX_ATTACHMENT_SIZE)) return Response.json({ error: 'Each attachment must be 10 MB or smaller.' }, { status: 400 });
    if (files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_TOTAL) return Response.json({ error: 'Attachments must total 25 MB or less.' }, { status: 400 });
    if (files.length && !this.env.LUNA_ATTACHMENTS) return Response.json({ error: 'Private attachment storage is not configured yet.' }, { status: 503 });
    if (!this.env.LUNA_GITHUB_ACTIONS_TOKEN) return Response.json({ error: 'Luna cloud runner is not configured.' }, { status: 503 });
    if (!(await this.ctx.storage.get('codexAuth')) && !this.env.CODEX_SIWC_CREDENTIALS) {
      return Response.json({ error: 'Luna ChatGPT sign-in is not configured.' }, { status: 503 });
    }

    const previousId = await this.ctx.storage.get('currentTaskId');
    const previous = previousId ? await this.ctx.storage.get(`task:${previousId}`) : null;
    if (previous?.status === 'running') return Response.json({ error: 'Luna is already working on a request. Wait for it to finish.' }, { status: 409 });

    const task = {
      taskId,
      prompt,
      attachments: [],
      status: 'running',
      message: "Creating Luna's environment…",
      createdAt: new Date().toISOString()
    };
    await this.ctx.storage.put('currentTaskId', task.taskId);
    await this.ctx.storage.put(`task:${task.taskId}`, task);
    await this.ctx.storage.setAlarm(Date.now() + TASK_START_TIMEOUT_MS);

    try {
      for (const [index, file] of files.entries()) {
        const filename = file.name.replaceAll('\\', '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 180) || `attachment-${index + 1}`;
        const key = `tasks/${task.taskId}/${index}`;
        const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream';
        await this.env.LUNA_ATTACHMENTS.put(key, file.stream(), {
          httpMetadata: { contentType },
          customMetadata: { filename, size: String(file.size) }
        });
        task.attachments.push({ key, filename, contentType, size: file.size });
      }
      await this.saveTask(task);
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/${GITHUB_WORKFLOW}/dispatches`, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.env.LUNA_GITHUB_ACTIONS_TOKEN}`,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'SweetHopeBakery-Luna-Relay',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ ref: 'main', inputs: { taskId: task.taskId } })
      });
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      this.log('workflow_dispatched', { taskId: task.taskId });
    } catch (error) {
      await this.deleteTaskAttachments(task);
      this.log('workflow_dispatch_failed', { taskId: task.taskId });
      await this.saveTask({
        taskId: task.taskId,
        status: 'failed',
        message: 'GitHub could not start Luna’s temporary runner. Check its Actions configuration.',
        summary: String(error?.message || error).slice(0, 300),
        updatedAt: new Date().toISOString(),
        retainUntil: Date.now() + TASK_RETENTION_MS
      });
      await this.scheduleCleanup();
      return Response.json({ error: 'Luna could not start the cloud runner. Check GitHub Actions configuration and try again.' }, { status: 503 });
    }

    return Response.json({ taskId: task.taskId, status: task.status }, { status: 202 });
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
    if (this.env.LUNA_ATTACHMENTS && task.attachments?.length) {
      await Promise.allSettled(task.attachments.map(({ key }) => this.env.LUNA_ATTACHMENTS.delete(key)));
      task.attachments = [];
    }
    await this.saveTask(task);
  }

  async readTask(taskId) {
    const task = await this.ctx.storage.get(`task:${taskId}`);
    if (!task || (task.retainUntil && Date.now() >= task.retainUntil)) {
      if (task) await this.ctx.storage.delete(`task:${taskId}`);
      return Response.json({ error: 'Task not found.' }, { status: 404 });
    }
    const { prompt: _prompt, attachments: _attachments, ...publicTask } = task;
    return Response.json(publicTask);
  }

  async saveTask(task) {
    await this.ctx.storage.put(`task:${task.taskId}`, task);
    if (await this.ctx.storage.get('currentTaskId') === task.taskId) await this.ctx.storage.put('currentTaskId', task.taskId);
  }

  async recordWorkflowRun(request, taskId) {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const currentId = await this.ctx.storage.get('currentTaskId');
    const task = await this.ctx.storage.get(`task:${taskId}`);
    if (currentId !== taskId || task?.status !== 'running' || !/^\d{1,20}$/.test(body.runId || '')) {
      return Response.json({ error: 'The workflow run is not attached to an active Luna task.' }, { status: 409 });
    }
    await this.saveTask({ ...task, workflowRunUrl: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${body.runId}` });
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

    let attachment;
    try { attachment = socket.deserializeAttachment() || {}; } catch { attachment = {}; }
    if (!attachment.authenticated) {
      const currentId = await this.ctx.storage.get('currentTaskId');
      const task = currentId ? await this.ctx.storage.get(`task:${currentId}`) : null;
      if (
        data?.type !== 'authenticate' ||
        data.token !== this.env.CODEX_AGENT_RELAY_TOKEN ||
        typeof data.taskId !== 'string' ||
        task?.status !== 'running' ||
        task.taskId !== data.taskId ||
        data.phase !== 'agent' ||
        !task.prompt
      ) {
        socket.close(1008, 'Authentication required for an active task');
        return;
      }

      const sessionId = crypto.randomUUID();
      socket.serializeAttachment({ authenticated: true, sessionId, taskId: task.taskId, phase: data.phase });
      await this.ctx.storage.put('runnerSessionId', sessionId);
      const deadlineAt = Date.now() + TASK_TIMEOUT_MS;
      await this.ctx.storage.setAlarm(deadlineAt);
      await this.saveTask({
        ...task,
        deadlineAt,
        message: 'Luna is working in a temporary cloud runner.',
        updatedAt: new Date().toISOString()
      });
      const taskUpdate = await this.ctx.storage.get(`task:${task.taskId}`);
      if (typeof data.runId === 'string' && /^\d{1,20}$/.test(data.runId)) {
        await this.saveTask({ ...taskUpdate, workflowRunUrl: `https://github.com/${GITHUB_REPOSITORY}/actions/runs/${data.runId}` });
        this.log('workflow_run_observed', { taskId: task.taskId, runId: data.runId });
      }
      socket.send(JSON.stringify({ type: 'authenticated', taskId: task.taskId, phase: 'agent' }));
      socket.send(JSON.stringify({ type: 'task', taskId: task.taskId, prompt: task.prompt }));
      return;
    }

    const activeSessionId = await this.ctx.storage.get('runnerSessionId');
    if (attachment.sessionId !== activeSessionId) {
      socket.close(1001, 'Runner session replaced');
      return;
    }
    const currentId = await this.ctx.storage.get('currentTaskId');
    const task = currentId ? await this.ctx.storage.get(`task:${currentId}`) : null;
    if (!task || task.taskId !== attachment.taskId || task.status !== 'running') return;

    if (data?.type === 'credential-request') {
      let auth = await this.ctx.storage.get('codexAuth');
      if (!auth && this.env.CODEX_SIWC_CREDENTIALS) {
        try { auth = JSON.parse(this.env.CODEX_SIWC_CREDENTIALS); } catch { /* Invalid bootstrap data is reported to the runner. */ }
      }
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
      const status = ['complete', 'pushed', 'failed'].includes(data.status) ? data.status : 'running';
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
      if (['complete', 'pushed', 'failed'].includes(status)) delete updatedTask.prompt;
      await this.saveTask(updatedTask);
      if (['complete', 'pushed', 'failed'].includes(status)) {
        updatedTask.retainUntil = Date.now() + TASK_RETENTION_MS;
        await this.saveTask(updatedTask);
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
    if (task?.status === 'running') {
      const { prompt: _prompt, ...expiredTask } = task;
      const failedTask = { ...expiredTask, status: 'failed', message: 'Luna’s temporary runner did not finish before its time limit.', updatedAt: new Date().toISOString(), retainUntil: now + TASK_RETENTION_MS };
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
          method: 'POST', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${this.env.LUNA_GITHUB_ACTIONS_TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'SweetHopeBakery-Luna-Relay' }
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
      if (task.retainUntil && task.retainUntil <= now) await this.ctx.storage.delete(key);
      else if (task.retainUntil) next = Math.min(next, task.retainUntil);
    }
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
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
