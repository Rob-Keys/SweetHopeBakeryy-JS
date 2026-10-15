import { checkAuth } from '../../_auth.js';
import { getRelayStub, relayRequest, privateRelayResponse } from '../_agent.js';

export async function onRequestGet(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const relay = getRelayStub(context);
  if (!relay) return Response.json({ online: false, configured: false });
  return privateRelayResponse(await relay.stub.fetch(relayRequest(relay.secret, '/internal/status')));
}
