// Shared Stripe helpers for Cloudflare Pages Functions

function appendForm(params, key, value) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      appendForm(params, `${key}[${index}]`, item);
    });
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendForm(params, `${key}[${childKey}]`, childValue);
    }
    return;
  }
  params.append(key, String(value));
}

export async function stripeRequest(secretKey, method, path, body) {
  const headers = {
    'Authorization': `Bearer ${secretKey}`,
    'Stripe-Version': '2026-01-28.clover'
  };
  const init = { method, headers };
  if (body) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      appendForm(params, key, value);
    }
    init.body = params.toString();
  }

  const res = await fetch(`https://api.stripe.com/v1${path}`, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: { message: text || 'Stripe API error' } };
  }

  if (!res.ok) {
    const message = data?.error?.message || `Stripe API error (${res.status})`;
    throw new Error(message);
  }
  return data;
}
