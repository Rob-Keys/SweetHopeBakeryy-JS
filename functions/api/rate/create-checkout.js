// POST /api/rate/create-checkout
// Creates a Stripe Checkout session for the current cart.
// Requires env: STRIPE_SECRET_KEY, AWS_KEY, AWS_SECRET_KEY

import { stripeRequest } from '../_stripe.js';
import { saveOrderSnapshot } from '../_orders.js';
import products from '../../../src/data/products.json';

function getReturnUrl(request, env) {
  const requestOrigin = new URL(request.url).origin;
  let base = requestOrigin;
  if (env.PUBLIC_SITE_URL) {
    try {
      const envOrigin = new URL(env.PUBLIC_SITE_URL).origin;
      // Avoid cross-environment redirects (preview -> prod) that can invalidate return_url verification.
      if (envOrigin === requestOrigin) {
        base = env.PUBLIC_SITE_URL;
      }
    } catch {
      // Ignore invalid PUBLIC_SITE_URL and fall back to the request origin.
    }
  }
  return new URL('/return?session_id={CHECKOUT_SESSION_ID}', base).toString();
}

function buildStripeLineItems(cartLines, products) {
  const productMap = new Map(products.map(p => [p.itemName, p]));

  return cartLines.map((line) => {
    const name = String(line.name || '');
    const quantityKey = String(line.quantityKey || '');
    const customizations = [...new Set(Array.isArray(line.customizations) ? line.customizations.map(String) : [])].sort();

    const product = productMap.get(name);
    if (!product) throw new Error(`Unknown product: ${name}`);

    const price = product.prices?.[quantityKey];
    if (price === undefined) throw new Error(`Invalid quantity for ${name}`);
    const customTotal = customizations.reduce((total, option) => {
      const optionPrice = product.customizations?.[option];
      if (optionPrice === undefined || !Number.isFinite(Number(optionPrice)) || Number(optionPrice) < 0) {
        throw new Error(`Invalid customization for ${name}`);
      }
      return total + Number(optionPrice);
    }, 0);
    const priceCents = Math.round((Number(price) + customTotal) * 100);
    if (!Number.isFinite(priceCents) || priceCents <= 0) throw new Error(`Invalid price for ${name}`);
    const displayName = customizations.length ? `${name} — ${customizations.join(', ')}` : name;

    return {
      price_data: {
        currency: 'usd',
        product_data: {
          name: displayName,
          metadata: { actual_quantity: quantityKey, customizations: customizations.join(', ') }
        },
        unit_amount: priceCents
      },
      quantity: 1
    };
  });
}

function buildCartSummary(cartLines, products) {
  const productMap = new Map(products.map(p => [p.itemName, p]));
  const cart = {};
  let totalCents = 0;

  for (const line of cartLines) {
    const name = String(line?.name || '');
    const quantityKey = String(line?.quantityKey || '');
    const customizations = [...new Set(Array.isArray(line?.customizations) ? line.customizations.map(String) : [])].sort();
    const product = productMap.get(name);
    if (!product) throw new Error(`Unknown product: ${name}`);

    const priceValue = product.prices?.[quantityKey];
    const customTotal = customizations.reduce((total, option) => {
      const optionPrice = product.customizations?.[option];
      if (optionPrice === undefined || !Number.isFinite(Number(optionPrice)) || Number(optionPrice) < 0) {
        throw new Error(`Invalid customization for ${name}`);
      }
      return total + Number(optionPrice);
    }, 0);
    const priceCents = Math.round((Number(priceValue) + customTotal) * 100);
    const quantity = Number(quantityKey);
    if (!Number.isFinite(priceCents) || priceCents <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Invalid quantity for ${name}`);
    }

    const displayName = customizations.length ? `${name} — ${customizations.join(', ')}` : name;
    if (!cart[displayName]) {
      cart[displayName] = { name, quantity: 0, priceCents: 0, customizations };
    }
    cart[displayName].quantity += quantity;
    cart[displayName].priceCents += priceCents;
    totalCents += priceCents;
  }

  for (const item of Object.values(cart)) {
    item.price = item.priceCents / 100;
    delete item.priceCents;
  }

  return { cart, total: totalCents / 100, amountTotal: totalCents };
}

async function persistOrderSnapshot(context, sessionId, cartLines, cartSummary) {
  if (!sessionId) throw new Error('Unable to persist checkout order');
  const payload = {
    cart: cartSummary.cart,
    cart_total: cartSummary.total,
    amount_total: cartSummary.amountTotal,
    cartLines
  };
  await saveOrderSnapshot(context, sessionId, payload);
}

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }
  if (!context.env.AWS_KEY || !context.env.AWS_SECRET_KEY) {
    return Response.json({ error: 'AWS credentials not configured' }, { status: 500 });
  }

  let stage = 'parse_request';
  let stripeSessionId = null;
  try {
    const { cartLines, idempotencyKey } = await context.request.json();
    if (!Array.isArray(cartLines) || cartLines.length === 0) {
      return Response.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(idempotencyKey || ''))) {
      return Response.json({ error: 'Invalid checkout request' }, { status: 400 });
    }

    stage = 'load_catalog';
    stage = 'validate_cart';
    const stripeLineItems = buildStripeLineItems(cartLines, products);
    const cartSummary = buildCartSummary(cartLines, products);

    stage = 'create_stripe_session';
    const session = await stripeRequest(STRIPE_SECRET_KEY, 'POST', '/checkout/sessions', {
      line_items: stripeLineItems,
      mode: 'payment',
      ui_mode: 'custom',
      return_url: getReturnUrl(context.request, context.env)
    }, { idempotencyKey });
    stripeSessionId = session?.id || null;

    stage = 'save_order_snapshot';
    await persistOrderSnapshot(context, session?.id, cartLines, cartSummary);

    return Response.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      cart: cartSummary.cart,
      cartTotal: cartSummary.total,
      amountTotal: cartSummary.amountTotal
    });
  } catch (err) {
    console.error(JSON.stringify({
      message: 'create_checkout_failed',
      stage,
      sessionId: stripeSessionId,
      rayId: context.request.headers.get('cf-ray') || null,
      errorName: err?.name || 'Error',
      error: String(err?.message || 'Unknown error').slice(0, 300)
    }));
    const message = String(err?.message || '');
    if (message.includes('Unknown product') || message.includes('Invalid quantity') || message.includes('Invalid customization') || message.includes('Invalid price') || message.includes('Cart is empty')) {
      return Response.json({ error: 'Invalid cart' }, { status: 400 });
    }
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
