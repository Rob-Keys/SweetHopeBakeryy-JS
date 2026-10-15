import { checkAuth } from '../../_auth.js';
import { getRelayStub, relayRequest, relayUnavailable, privateRelayResponse } from '../_agent.js';

export async function onRequestGet(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const taskId = context.params.taskId;
  if (!/^[0-9a-f-]{36}$/i.test(taskId || '')) {
    return Response.json({ error: 'Invalid task ID.' }, { status: 400 });
  }
  const relay = getRelayStub(context);
  if (!relay) return relayUnavailable();
  return privateRelayResponse(await relay.stub.fetch(relayRequest(relay.secret, `/internal/tasks/${encodeURIComponent(taskId)}`)));
}
