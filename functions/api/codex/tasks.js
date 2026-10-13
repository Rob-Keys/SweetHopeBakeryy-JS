import { checkAuth } from '../_auth.js';
import { getRelayStub, relayRequest, relayUnavailable } from './_agent.js';

const MAX_PROMPT_LENGTH = 12000;

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const relay = getRelayStub(context);
  if (!relay) return relayUnavailable();

  let form;
  try {
    form = await context.request.formData();
  } catch {
    return Response.json({ error: 'Request body must be multipart form data.' }, { status: 400 });
  }
  const prompt = typeof form.get('prompt') === 'string' ? form.get('prompt').trim() : '';
  if (!prompt) return Response.json({ error: 'Describe the change you want.' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return Response.json({ error: `Prompt must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.` }, { status: 400 });
  }

  const relayBody = new FormData();
  relayBody.set('prompt', prompt);
  for (const attachment of form.getAll('attachments')) {
    if (attachment instanceof File) relayBody.append('attachments', attachment, attachment.name);
  }

  return relay.stub.fetch(relayRequest(relay.secret, '/internal/tasks', {
    method: 'POST',
    body: relayBody
  }));
}
