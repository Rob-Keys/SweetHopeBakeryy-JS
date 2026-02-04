// POST /api/rate/create-checkout
// Creates a Stripe checkout session
// Env vars: STRIPE_SECRET_KEY

import Stripe from 'stripe';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const PRODUCTS_KEY = 'data/products.json';

function getReturnUrl(request, env) {
  const base = env.PUBLIC_SITE_URL || new URL(request.url).origin;
  return new URL('/return?session_id={CHECKOUT_SESSION_ID}', base).toString();
}

async function loadProducts(context) {
  const { AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1' } = context.env;
  if (AWS_KEY && AWS_SECRET_KEY) {
    const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
    const s3 = new S3Client({ region: AWS_REGION, credentials });
    const obj = await s3.send(new GetObjectCommand({
      Bucket: 'sweethopebakeryy',
      Key: PRODUCTS_KEY
    }));
    return JSON.parse(await obj.Body.transformToString());
  }

  const fallbackUrl = new URL('/data/products.json', new URL(context.request.url).origin);
  const res = await fetch(fallbackUrl.toString());
  if (!res.ok) throw new Error('Unable to load products data');
  return await res.json();
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

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY } = context.env;
  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }

  try {
    const { cartLines } = await context.request.json();
    if (!Array.isArray(cartLines) || cartLines.length === 0) {
      return Response.json({ error: 'Cart is empty' }, { status: 400 });
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY);

    const products = await loadProducts(context);
    const stripeLineItems = buildStripeLineItems(cartLines, products);

    const session = await stripe.checkout.sessions.create({
      line_items: stripeLineItems,
      mode: 'payment',
      ui_mode: 'custom',
      return_url: getReturnUrl(context.request, context.env)
    });

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
