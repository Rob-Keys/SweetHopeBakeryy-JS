// POST /api/rate/create-checkout
// Creates a Stripe checkout session
// Env vars: STRIPE_SECRET_KEY

import { getKv } from '../_kv.js';
import { stripeRequest } from '../_stripe.js';

const PRODUCTS_KEY = 'data/products.json';

function getReturnUrl(request, env) {
  const requestOrigin = new URL(request.url).origin;
  let base = requestOrigin;
  if (env.PUBLIC_SITE_URL) {
    try {
      const envOrigin = new URL(env.PUBLIC_SITE_URL).origin;
      // Avoid cross-environment redirects (preview -> prod) that break verification
      if (envOrigin === requestOrigin) {
        base = env.PUBLIC_SITE_URL;
      }
    } catch {
      // ignore malformed PUBLIC_SITE_URL
    }
  }
  return new URL('/return?session_id={CHECKOUT_SESSION_ID}', base).toString();
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
