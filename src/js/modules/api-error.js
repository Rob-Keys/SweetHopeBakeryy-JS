export async function readApiError(response, fallback = '') {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const defaultMessage = fallback || status;
  let body = '';
  try {
    body = await response.text();
  } catch {
    return defaultMessage;
  }

  if (!body) return defaultMessage;
  try {
    const parsed = JSON.parse(body);
    const message = parsed?.error || parsed?.message || parsed?.detail || parsed?.title || parsed?.code;
    if (typeof message === 'string' && message.trim()) return message.trim();
    if (Array.isArray(parsed?.errors) && parsed.errors.length) {
      return parsed.errors.map(error => typeof error === 'string' ? error : error?.message || error?.code).filter(Boolean).join('; ') || defaultMessage;
    }
    return defaultMessage;
  } catch {
    const message = body.trim().startsWith('<')
      ? body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ').trim()
      : body.trim();
    return message ? `${status}: ${message.slice(0, 1000)}` : defaultMessage;
  }
}
