export const RELAY_OBJECT_NAME = 'sweet-hope-bakery-codex-agent';

export function getRelayStub(context) {
  const namespace = context.env.CODEX_AGENT_RELAY;
  const secret = context.env.CODEX_AGENT_RELAY_TOKEN;
  if (!namespace || !secret) return null;
  return {
    secret,
    stub: namespace.get(namespace.idFromName(RELAY_OBJECT_NAME))
  };
}

export function relayRequest(secret, path, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${secret}`);
  return new Request(`https://codex-agent-relay.internal${path}`, { ...init, headers });
}

export function relayUnavailable() {
  return Response.json({ error: 'The Luna cloud relay is not configured.' }, { status: 503 });
}
