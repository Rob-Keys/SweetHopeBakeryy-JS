import { checkAuth } from '../_auth.js';
import { getRelayStub, relayRequest, relayUnavailable, privateRelayResponse } from './_agent.js';

import { readTaskForm } from '../../../codex-relay/task-request.js';

const MAX_PROMPT_LENGTH = 12000;

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const relay = getRelayStub(context);
  if (!relay) return relayUnavailable();

  let form;
  try {
    form = await readTaskForm(context.request);
  } catch (error) {
    return Response.json({ error: error.message }, { status: error.status || 400 });
  }
  const prompt = typeof form.get('prompt') === 'string' ? form.get('prompt').trim() : '';
  if (!prompt) return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json({ error: `Prompt must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
  }

  const files = form.getAll('attachments');
  if (files.some(file => !(file instanceof File) || file.size === 0) || files.length > 5 || files.some(file => file.size > 10 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
    return Response.json({ error: 'Attach up to 5 non-empty files, 10 MB each and 25 MB total.' }, { status: 400 });
  }

  const relayBody = new FormData();
  // The browser saves this ID before sending, so a lost response is recoverable.
  const taskId = form.get('taskId') || crypto.randomUUID();
  if (typeof taskId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(taskId)) {
    return Response.json({ error: 'Invalid task ID.' }, { status: 400 });
  }
  relayBody.set('taskId', taskId);
  relayBody.set('prompt', prompt);
  for (const attachment of form.getAll('attachments')) {
    if (attachment instanceof File) relayBody.append('attachments', attachment, attachment.name);
  }

  return privateRelayResponse(await relay.stub.fetch(relayRequest(relay.secret, '/internal/tasks', {
    method: 'POST',
    body: relayBody
  })));
}
