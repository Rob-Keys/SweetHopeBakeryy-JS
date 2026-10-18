import { getAuthToken, handle401 } from './auth.js';
import { readApiError } from './api-error.js';

const TASK_KEY = 'luna-active-task';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL = ['complete', 'pushed', 'uncertain', 'failed'];

export function initLocalCodeAgentHandlers() {
  const form = document.getElementById('local-code-agent-form');
  if (!form || form.dataset.initialized) return;
  form.dataset.initialized = 'true';
  const connection = form.parentElement.querySelector('[data-agent-connection]');
  const indicator = form.parentElement.querySelector('.local-agent-indicator');
  const status = form.querySelector('[data-agent-task]');
  const submit = form.querySelector('[data-agent-submit]');
  const prompt = form.elements.prompt;
  const files = form.elements.attachments;
  const help = form.querySelector('[data-agent-files-help]');
  const privateHelp = 'Attachments stay private and are deleted after Luna finishes.';
  let online = false;
  let attachmentsAvailable = false;
  let busy = false;
  let submitting = false;
  let activeTask = null;
  let taskTimer;
  let connectionTimer;
  let checkingConnection = false;
  let generation = 0;
  let deploymentTimer;
  let disposed = false;
  let storageUnavailable = false;

  const save = task => {
    try {
      if (task) sessionStorage.setItem(TASK_KEY, JSON.stringify(task));
      else sessionStorage.removeItem(TASK_KEY);
    } catch { storageUnavailable = true; }
  };
  const controls = () => {
    const working = submitting || Boolean(activeTask) || busy;
    prompt.disabled = working;
    files.disabled = working || !online || !attachmentsAvailable;
    submit.disabled = working || !online;
    submit.textContent = submitting ? 'Sending…' : activeTask ? 'Working…' : 'Send to Luna';
  };
  const adminFetch = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options, cache: 'no-store', signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${getAuthToken()}`, ...options.headers }
    });
    if (response.status === 401) {
      disposed = true;
      window.clearTimeout(taskTimer);
      window.clearTimeout(connectionTimer);
      handle401();
      throw new Error('Please sign in again to continue checking your saved request.');
    }
    return response;
  };
  const render = (task, result) => {
    status.hidden = false;
    status.dataset.taskId = task.taskId;
    status.replaceChildren();
    const requestLabel = document.createElement('strong');
    requestLabel.textContent = 'Your request to Luna';
    const echo = document.createElement('pre');
    echo.textContent = task.prompt;
    const title = document.createElement('strong');
    title.textContent = ({ complete: 'Luna response', pushed: 'Luna pushed a change', uncertain: 'Outcome needs checking', failed: 'Request failed' })[result.status] || 'Luna is working on your request…';
    status.append(requestLabel, echo, title);
    for (const [value, tag] of [[result.summary, 'pre'], [result.message, 'p']]) {
      if (typeof value !== 'string' || !value) continue;
      const element = document.createElement(tag);
      element.textContent = value;
      status.append(element);
    }
    if (/^https:\/\/github\.com\/Rob-Keys\/SweetHopeBakeryy-JS\/actions\/runs\/\d+$/.test(result.workflowRunUrl || '')) {
      const link = document.createElement('a');
      link.href = result.workflowRunUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View GitHub Actions run';
      status.append(link);
    }
    if (storageUnavailable && activeTask) {
      const note = document.createElement('p');
      note.textContent = 'This browser could not save reload recovery. Keep this page open to follow the result.';
      status.append(note);
    }
  };
  const verifyDeployment = (commit, taskId, token) => {
    if (!/^[0-9a-f]{7,40}$/i.test(commit || '')) return;
    let attempts = 0;
    const check = async () => {
      if (disposed || generation !== token || status.dataset.taskId !== taskId) return;
      attempts += 1;
      let deployed;
      try {
        const response = await fetch('/api/deployment-version', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.ok) deployed = (await response.json()).commit;
      } catch { /* Retry deployment checks independently of task completion. */ }
      if (disposed || generation !== token || status.dataset.taskId !== taskId) return;
      const matched = /^[0-9a-f]{7,40}$/i.test(deployed || '') && (commit.startsWith(deployed) || deployed.startsWith(commit));
      if (matched || attempts >= 30) {
        const note = document.createElement('p');
        note.textContent = matched ? `Cloudflare Pages is serving commit ${deployed}.` : 'The live Pages commit has not been confirmed yet. Check the deployment before retrying this request.';
        status.append(note);
      } else deploymentTimer = window.setTimeout(check, 10000);
    };
    void check();
  };

  const followTask = (task, initialMessage = 'Checking the saved request…') => {
    window.clearTimeout(taskTimer);
    window.clearTimeout(deploymentTimer);
    const token = ++generation;
    activeTask = task;
    busy = true;
    save(task);
    render(task, { status: 'running', message: initialMessage });
    controls();
    let failures = 0;
    let missing = 0;
    const poll = async () => {
      if (disposed || token !== generation) return;
      try {
        const response = await adminFetch(`/api/codex/tasks/${encodeURIComponent(task.taskId)}`);
        if (disposed || token !== generation) return;
        if (response.status === 404 && (task.confirmed || ++missing >= 5)) {
          activeTask = null;
          busy = false;
          save(null);
          render(task, { status: 'failed', message: task.confirmed ? 'This saved result has expired. You can send a new request.' : 'The request was not found. You can send it again.' });
          await refreshConnection();
          controls();
          return;
        }
        if (!response.ok) throw new Error(await readApiError(response, 'Could not get the latest task status.'));
        const result = await response.json();
        if (result.taskId !== task.taskId || !['running', ...TERMINAL].includes(result.status)) throw new Error('Luna returned an invalid task status.');
        task.confirmed = true;
        save(task);
        failures = 0;
        render(task, result);
        if (TERMINAL.includes(result.status)) {
          activeTask = null;
          busy = false;
          controls();
          if (result.status === 'pushed') verifyDeployment(result.commit, task.taskId, token);
          void refreshConnection();
          return;
        }
        taskTimer = window.setTimeout(poll, 2500);
      } catch (error) {
        if (disposed || token !== generation) return;
        failures += 1;
        render(task, { status: 'running', message: `${error.message} ${failures >= 5 ? 'Automatic retries paused. Check the saved request below.' : 'Retrying automatically…'}` });
        if (failures >= 5) {
          const retry = document.createElement('button');
          retry.type = 'button';
          retry.className = 'btn btn-cookie';
          retry.textContent = 'Check request status';
          retry.addEventListener('click', () => followTask(task), { once: true });
          status.append(retry);
        } else taskTimer = window.setTimeout(poll, Math.min(2500 * (2 ** (failures - 1)), 30000));
      }
    };
    void poll();
  };
  const refreshConnection = async () => {
    if (disposed || checkingConnection) return;
    checkingConnection = true;
    try {
      const response = await adminFetch('/api/codex/agent/status');
      if (!response.ok) throw new Error(await readApiError(response, 'Luna status unavailable'));
      const result = await response.json();
      online = Boolean(result.configured);
      attachmentsAvailable = Boolean(result.attachmentsConfigured);
      busy = Boolean(result.busy);
      connection.textContent = online ? busy || activeTask || submitting ? 'Busy' : 'Ready' : 'Unavailable';
      if (busy && !activeTask && !submitting && UUID.test(result.taskId || '')) {
        followTask({ taskId: result.taskId, prompt: 'Request started in another tab or browser.', confirmed: true });
      }
    } catch (error) {
      online = false;
      connection.textContent = `Unavailable — ${error.message || String(error)}; retrying automatically`;
    } finally {
      checkingConnection = false;
      indicator.classList.toggle('is-online', online);
      indicator.classList.toggle('is-offline', !online);
      if (!files.files?.length) help.textContent = attachmentsAvailable ? privateHelp : 'File attachments are not configured for Luna yet.';
      controls();
    }
  };

  const validateFiles = () => {
    const selected = Array.from(files.files || []);
    const empty = selected.find(file => file.size === 0);
    const large = selected.find(file => file.size > 10 * 1024 * 1024);
    files.setCustomValidity(selected.length > 5 ? 'Attach no more than 5 files.' : empty ? `${empty.name} is empty.` : large ? `${large.name} is larger than 10 MB.` : selected.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024 ? 'Attachments must total 25 MB or less.' : '');
    help.textContent = selected.length ? selected.map(file => `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`).join(' · ') : privateHelp;
    return files.reportValidity();
  };
  files.addEventListener('change', validateFiles);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const request = prompt.value.trim();
    if (!request || request.length > 12000 || submitting || activeTask || busy || !online || !validateFiles()) return;
    if (files.files.length && !attachmentsAvailable) {
      help.textContent = 'Attachments are unavailable. Remove the selected files or wait for attachment storage to return.';
      return;
    }
    const task = { taskId: crypto.randomUUID(), prompt: request, confirmed: false };
    save(task);
    submitting = true;
    ++generation;
    window.clearTimeout(deploymentTimer);
    controls();
    render(task, { status: 'running', message: 'Sending your request…' });
    try {
      const body = new FormData();
      body.set('taskId', task.taskId);
      body.set('prompt', request);
      Array.from(files.files).forEach(file => body.append('attachments', file, file.name));
      const response = await adminFetch('/api/codex/tasks', { method: 'POST', body });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`${result.error || `HTTP ${response.status}`}. Checking whether the request was received.`);
        save(null);
        render(task, { status: 'failed', message: result.error || 'Could not send the request.' });
        return;
      }
      if (result.taskId !== task.taskId) throw new Error('The submission response was not confirmed.');
      task.confirmed = true;
      files.value = '';
      files.setCustomValidity('');
      help.textContent = privateHelp;
      followTask(task);
    } catch (error) {
      // A failed response does not mean the server failed to accept the request.
      if (!disposed) followTask(task, `${error.message || String(error)} Checking whether the request was received…`);
    } finally {
      submitting = false;
      controls();
      if (!disposed) void refreshConnection();
    }
  });

  const scheduleConnection = () => {
    window.clearTimeout(connectionTimer);
    if (disposed || document.hidden) return;
    void refreshConnection().finally(() => {
      if (!disposed && !document.hidden) connectionTimer = window.setTimeout(scheduleConnection, 15000);
    });
  };
  document.addEventListener('visibilitychange', scheduleConnection);
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    disposed = true;
    ++generation;
    for (const timer of [taskTimer, connectionTimer, deploymentTimer]) window.clearTimeout(timer);
  });
  try {
    const saved = JSON.parse(sessionStorage.getItem(TASK_KEY) || 'null');
    if (saved && UUID.test(saved.taskId || '') && typeof saved.prompt === 'string') {
      prompt.value = saved.prompt;
      followTask(saved);
    }
  } catch { /* Invalid or unavailable browser storage does not block new requests. */ }
  scheduleConnection();
}
