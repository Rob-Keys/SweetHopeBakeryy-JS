export function describeError(error, operation) {
  const parts = [];
  if (typeof error?.name === 'string' && error.name !== 'Error') parts.push(error.name);
  if (typeof error?.message === 'string' && error.message.trim()) parts.push(error.message.trim());
  const status = error?.$metadata?.httpStatusCode;
  if (Number.isInteger(status)) parts.push(`HTTP ${status}`);
  const detail = parts.length ? parts.join(': ') : 'Unknown error';
  return `${operation} failed: ${detail}`;
}
