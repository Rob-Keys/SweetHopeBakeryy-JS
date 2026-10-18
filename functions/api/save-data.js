// POST /api/save-data
// Authenticated deterministic content edit committed through the Cloudflare relay.

import { checkAuth } from './_auth.js';
import { getRelayStub, relayRequest, relayUnavailable, privateRelayResponse } from './codex/_agent.js';

export async function onRequestPost(context) {
  const denied = await checkAuth(context);
  if (denied) return denied;

  const relay = getRelayStub(context);
  if (!relay) return relayUnavailable();

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  return privateRelayResponse(await relay.stub.fetch(relayRequest(relay.secret, '/internal/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, operation: 'save' })
  })));
}
