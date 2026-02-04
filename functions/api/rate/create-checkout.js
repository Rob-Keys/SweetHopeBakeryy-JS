// POST /api/rate/create-checkout
// Creates a Stripe checkout session
// Env vars: STRIPE_SECRET_KEY

const KV_BINDING = 'kv-db';
const PRODUCTS_KEY = 'data/products.json';

function getReturnUrl(request, env) {
  const base = env.PUBLIC_SITE_URL || new URL(request.url).origin;
  return new URL('/return?session_id={CHECKOUT_SESSION_ID}', base).toString();
}

function getKv(context) {
  return context.env[KV_BINDING];
}

async function loadProducts(context) {
  const kv = getKv(context);
  if (!kv) throw new Error('KV binding not available');
  const data = await kv.get(PRODUCTS_KEY, 'json');
  if (!Array.isArray(data)) throw new Error('Unable to load products data');
  return data;
}

function buildStripeLineItems(cartLines, products) {
  const productMap = new Map(products.map(p => [p.itemName, p]));

  return cartLines.map((line) => {
    const name = String(line.name || '');
    const quantityKey = String(line.quantityKey || '');

    const product = productMap.get(name);
    if (!product) throw new Error(`Unknown product: ${name}`);

    const price = product.prices?.[quantityKey];
    if (price === undefined) throw new Error(`Invalid quantity for ${name}`);

    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name,
          metadata: { actual_quantity: quantityKey }
        },
        unit_amount: Math.round(Number(price) * 100)
      },
      quantity: 1
    };
  });
}

function buildCartSummary(cartLines, products) {
  const productMap = new Map(products.map(p => [p.itemName, p]));
  const cart = {};
  let total = 0;

  for (const line of cartLines) {
    const name = String(line?.name || '');
    const quantityKey = String(line?.quantityKey || '');
    const product = productMap.get(name);
    if (!product) throw new Error(`Unknown product: ${name}`);

    const priceValue = product.prices?.[quantityKey];
    const price = Number(priceValue);
    const quantity = Number(quantityKey);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) {
      throw new Error(`Invalid quantity for ${name}`);
    }

    if (!cart[name]) {
      cart[name] = { quantity: 0, price: 0 };
    }
    cart[name].quantity += quantity;
    cart[name].price += price;
    total += price;
  }

  return { cart, total };
}

async function persistOrderSnapshot(context, sessionId, cartLines, cartSummary) {
  const kv = getKv(context);
  if (!kv || !sessionId) return;
  const key = `orders/${sessionId}`;
  const payload = {
    cart: cartSummary.cart,
    cart_total: cartSummary.total,
    cartLines
  };
  try {
    await kv.put(key, JSON.stringify(payload), { expirationTtl: 60 * 60 * 24 });
  } catch (err) {
    console.warn('persistOrderSnapshot failed:', err);
  }
}

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

async function stripeRequest(secretKey, method, path, body) {
  const headers = {
    'Authorization': `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2026-01-28.clover'
  };
  const init = { method, headers };
  if (body) {
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

export async function onRequestPost(context) {
  console.log('create-checkout: using fetch-based Stripe client');
  const { STRIPE_SECRET_KEY } = context.env;
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }

  try {
    const { cartLines } = await context.request.json();
    if (!Array.isArray(cartLines) || cartLines.length === 0) {
      return Response.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const products = await loadProducts(context);
    const stripeLineItems = buildStripeLineItems(cartLines, products);
    const cartSummary = buildCartSummary(cartLines, products);

    const session = await stripeRequest(STRIPE_SECRET_KEY, 'POST', '/checkout/sessions', {
      line_items: stripeLineItems,
      mode: 'payment',
      ui_mode: 'custom',
      return_url: getReturnUrl(context.request, context.env)
    });

    await persistOrderSnapshot(context, session?.id, cartLines, cartSummary);

    return Response.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('create-checkout error:', err);
    const message = String(err?.message || '');
    if (message.includes('Unknown product') || message.includes('Invalid quantity') || message.includes('Cart is empty')) {
      return Response.json({ error: 'Invalid cart' }, { status: 400 });
    }
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
