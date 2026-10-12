const MAX_PROMPT_LENGTH = 12000;
const TASK_RETENTION_MS = 15 * 60 * 1000;
const PROBE_TIMEOUT_MS = 2500;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/agent') return new Response('Not found', { status: 404 });
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
    const taskMatch = url.pathname.match(/^\/internal\/tasks\/([0-9a-f-]{36})$/i);
    if (taskMatch && request.method === 'GET') return this.readTask(taskMatch[1]);
    return new Response('Not found', { status: 404 });
  }

  authorize(request) {
    const expected = this.env.CODEX_AGENT_RELAY_TOKEN;
    const provided = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    if (!expected) return Response.json({ error: 'Local agent relay is not configured.' }, { status: 503 });
    if (provided !== expected) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
    return null;
  }

  async status() {
    const socket = await this.getAgentSocket();
    const online = socket ? await this.probeAgent(socket) : false;
    const task = await this.ctx.storage.get('currentTask');
    return Response.json({ online, busy: task?.status === 'running' });
  }

  async probeAgent(socket) {
    if (this.pendingProbe?.socket === socket) return this.pendingProbe.promise;
    if (this.pendingProbe) {
      this.pendingProbe.resolve(false);
      this.pendingProbe = null;
    }

    let resolveProbe;
    const promise = new Promise(resolve => { resolveProbe = resolve; });
    const probe = { nonce: crypto.randomUUID(), socket, promise, resolve: resolveProbe };
    this.pendingProbe = probe;
    const timeout = setTimeout(() => resolveProbe(false), PROBE_TIMEOUT_MS);

    try {
      socket.send(JSON.stringify({ type: 'heartbeat-check', nonce: probe.nonce }));
    } catch {
      resolveProbe(false);
    }

    try {
      return await promise;
    } finally {
      clearTimeout(timeout);
      if (this.pendingProbe === probe) this.pendingProbe = null;
    }
  }

  async getAgentSocket() {
    const sessionId = await this.ctx.storage.get('agentSessionId');
    if (!sessionId) return null;
    for (const socket of this.ctx.getWebSockets('agent')) {
      try {
        const attachment = socket.deserializeAttachment();
        if (attachment?.authenticated && attachment.sessionId === sessionId && socket.readyState === WebSocket.OPEN) return socket;
      } catch { /* Ignore a socket whose attachment was not initialized yet. */ }
    }
    return null;
  }

  async startTask(request) {
    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid request body.' }, { status: 400 }); }
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
    if (prompt.length > MAX_PROMPT_LENGTH) return Response.json({ error: `Prompt must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });

    const socket = await this.getAgentSocket();
    if (!socket || !(await this.probeAgent(socket))) {
      return Response.json({ error: 'Your Mac is offline. Start the local agent and try again.' }, { status: 503 });
    }

    const previous = await this.ctx.storage.get('currentTask');
    if (previous?.status === 'running') return Response.json({ error: 'Your Mac is already working on a request. Wait for it to finish.' }, { status: 409 });

    const task = {
      taskId: crypto.randomUUID(),
      status: 'running',
      message: 'Your Mac is working on this change.',
      createdAt: new Date().toISOString()
    };
    await this.ctx.storage.put('currentTask', task);
    try {
      socket.send(JSON.stringify({ type: 'task', taskId: task.taskId, prompt }));
    } catch {
      await this.ctx.storage.put('currentTask', { ...task, status: 'failed', message: 'Your Mac disconnected before it received the request.' });
      await this.ctx.storage.setAlarm(Date.now() + TASK_RETENTION_MS);
      return Response.json({ error: 'Your Mac disconnected. Try again when it is online.' }, { status: 503 });
    }
    return Response.json({ taskId: task.taskId, status: task.status }, { status: 202 });
  }

  async readTask(taskId) {
    const task = await this.ctx.storage.get('currentTask');
    if (!task || task.taskId !== taskId) return Response.json({ error: 'Task not found.' }, { status: 404 });
    const { prompt: _prompt, ...publicTask } = task;
    return Response.json(publicTask);
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
      if (data?.type !== 'authenticate' || data.token !== this.env.CODEX_AGENT_RELAY_TOKEN) {
        socket.close(1008, 'Authentication required');
        return;
      }

      const previousSocket = await this.getAgentSocket();
      if (previousSocket && previousSocket !== socket) {
        previousSocket.close(1001, 'Agent reconnected');
      }

      const task = await this.ctx.storage.get('currentTask');
      if (task?.status === 'running' && task.taskId !== data.activeTaskId) {
        await this.ctx.storage.put('currentTask', { ...task, status: 'failed', message: 'The Mac agent restarted before this request finished.' });
        await this.ctx.storage.setAlarm(Date.now() + TASK_RETENTION_MS);
      }
      const sessionId = crypto.randomUUID();
      socket.serializeAttachment({ authenticated: true, sessionId });
      await this.ctx.storage.put('agentSessionId', sessionId);
      socket.send(JSON.stringify({ type: 'authenticated' }));
      return;
    }

    const activeSessionId = await this.ctx.storage.get('agentSessionId');
    if (attachment.sessionId !== activeSessionId) {
      socket.close(1001, 'Agent session replaced');
      return;
    }
    if (data?.type === 'heartbeat-response') {
      const probe = this.pendingProbe;
      if (probe?.socket === socket && data.nonce === probe.nonce) probe.resolve(true);
      return;
    }
    if (data?.type === 'task-update') {
      const task = await this.ctx.storage.get('currentTask');
      if (!task || task.taskId !== data.taskId || task.status !== 'running') return;
      const status = ['complete', 'failed'].includes(data.status) ? data.status : 'running';
      const updatedTask = {
        ...task,
        status,
        message: typeof data.message === 'string' ? data.message.slice(0, 500) : task.message,
        updatedAt: new Date().toISOString()
      };
      if (typeof data.summary === 'string') updatedTask.summary = data.summary.slice(0, 12000);
      await this.ctx.storage.put('currentTask', updatedTask);
      if (status === 'complete' || status === 'failed') {
        await this.ctx.storage.setAlarm(Date.now() + TASK_RETENTION_MS);
      }
    }
  }

  async alarm() {
    const task = await this.ctx.storage.get('currentTask');
    if (task && task.status !== 'running') await this.ctx.storage.delete('currentTask');
  }

  async webSocketClose(socket, code, reason) {
    try {
      const attachment = socket.deserializeAttachment();
      if (attachment?.sessionId !== await this.ctx.storage.get('agentSessionId')) return;
      if (this.pendingProbe?.socket === socket) this.pendingProbe.resolve(false);
    } catch { /* No heartbeat to clear for an unauthenticated socket. */ }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket, 1011, 'Connection error');
  }
}
