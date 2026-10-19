import { DOMParser, Node as XmlNode } from '@xmldom/xmldom';

// AWS SDK's browser XML parser is selected when Wrangler bundles Pages Functions.
// Workers do not provide DOMParser or the browser Node constants, so install the
// small XML DOM implementation before an AWS response needs to be deserialized.
globalThis.DOMParser ??= DOMParser;
globalThis.Node ??= XmlNode;

export function describeError(error, operation) {
  const parts = [];
  if (typeof error?.name === 'string' && error.name !== 'Error') parts.push(error.name);
  if (typeof error?.message === 'string' && error.message.trim()) parts.push(error.message.trim());
  const status = error?.$metadata?.httpStatusCode ?? error?.$response?.statusCode ?? error?.$response?.status;
  if (Number.isInteger(status)) parts.push(`HTTP ${status}`);
  const detail = parts.length ? parts.join(': ') : 'Unknown error';
  return `${operation} failed: ${detail}`;
}

export function adminErrorResponse(error, operation) {
  const message = describeError(error, operation);
  console.error(`${operation} error:`, message);

  // Cloudflare replaces Pages Function 5xx responses with a generic gateway
  // page, hiding the JSON error needed by the Admin interface.
  const upstreamStatus = error?.$metadata?.httpStatusCode ?? error?.$response?.statusCode ?? error?.$response?.status;
  const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus < 500
    ? upstreamStatus
    : 400;
  return Response.json({ error: message }, { status });
}
