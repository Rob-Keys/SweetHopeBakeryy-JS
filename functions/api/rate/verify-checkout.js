// POST /api/rate/verify-checkout
// Verifies Stripe payment and sends order confirmation emails server-side
// No auth required — triggered by customer after checkout
// Env vars: STRIPE_SECRET_KEY, AWS_KEY, AWS_SECRET_KEY, CAROLINE_EMAIL_ADDRESS, DEVELOPER_EMAIL_ADDRESS

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const KV_BINDING = 'kv-db';
const PRODUCTS_KEY = 'data/products.json';

function getKv(context) {
  return context.env[KV_BINDING];
}

async function loadProductsFromKv(context) {
  const kv = getKv(context);
  if (!kv) return null;
  const data = await kv.get(PRODUCTS_KEY, 'json');
  return Array.isArray(data) ? data : null;
}

function buildValidatedCart(cartLines, products) {
  if (!Array.isArray(cartLines) || cartLines.length === 0) {
    return { valid: false, cart: {}, total: 0 };
  }

  const productMap = new Map(products.map(p => [String(p.itemName), p]));
  const cart = {};
  let total = 0;

  for (const line of cartLines) {
    const name = String(line?.name || '');
    const quantityKey = String(line?.quantityKey || '');
    if (!name || !quantityKey) return { valid: false, cart: {}, total: 0 };

    const product = productMap.get(name);
    if (!product) return { valid: false, cart: {}, total: 0 };

    const priceValue = product.prices?.[quantityKey];
    const price = Number(priceValue);
    const quantity = Number(quantityKey);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return { valid: false, cart: {}, total: 0 };

    if (!cart[name]) {
      cart[name] = { quantity: 0, price: 0 };
    }
    cart[name].quantity += quantity;
    cart[name].price += price;
    total += price;
  }

  return { valid: true, cart, total };
}

async function stripeRequest(secretKey, method, path) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${secretKey}`
    }
  });
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

// Server-safe HTML escaping (no DOM APIs)
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateForDisplay(isoDate) {
  if (!isoDate) return '';
  const dt = new Date(isoDate + 'T00:00:00');
  if (isNaN(dt.getTime())) return isoDate;
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

function formatPrice(amount) {
  return Number(amount).toFixed(2);
}

const PICKUP_ADDRESS = 'Arlington, VA, 22207';

function buildCustomerReceipt(cart, cartTotal, details) {
  let body = `<h3>Thank you for your order with Sweet Hope Bakery!</h3>\n\n`;
  body += `<div style='background-color: #d4edda; border: 1px solid #28a745; padding: 15px; margin: 15px 0;'>`;
  body += `<strong>Payment successful!</strong> Your order has been confirmed.`;
  body += `</div>\n\n`;

  if (details.acquisition_method === 'delivery') {
    body += `<h4>Delivery Details:</h4>`;
    body += `<p>Delivery Address: ${escapeHtml(details.delivery_address || '')}</p>`;
    body += `<p>Requested Delivery on ${formatDateForDisplay(details.acquisition_date)}</p>`;
  } else {
    body += `<h4>Pickup Details:</h4>`;
    body += `<p>${escapeHtml(PICKUP_ADDRESS)}</p>`;
    body += `<p>Requested Pickup Date: ${formatDateForDisplay(details.acquisition_date)}</p>`;
    body += `<p>Coordinate a pickup time on your chosen day by texting 703-996-9846.</p>`;
  }

  body += `<h4>Summary:</h4>`;
  for (const [name, item] of Object.entries(cart)) {
    body += `<p>${item.quantity} x ${escapeHtml(name)}: $${formatPrice(item.price)}</p>`;
  }
  body += `<p><strong>Total: $${formatPrice(cartTotal)}</strong></p>`;
  body += `<hr><p>Thank you for your business!</p>`;
  body += `<p>We will contact you to coordinate pickup details.</p>`;
  body += `<p>For any questions, please contact support@sweethopebakeryy.com</p>`;
  body += `<img src='https://sweethopebakeryy.s3.us-east-1.amazonaws.com/header/sweethopebakeryy.avif' alt='Sweet Hope Bakery Logo' style='width:200px;height:auto;'/>`;

  return {
    subject: 'Your Sweet Hope Bakery Order Confirmation',
    body
  };
}

function buildOwnerNotification(cart, cartTotal, details) {
  const customerReceipt = buildCustomerReceipt(cart, cartTotal, details);

  let body = `<h3>New order received with the following details:</h3>\n\n`;
  body += `<div style='background-color: #d4edda; border: 1px solid #28a745; padding: 15px; margin: 15px 0;'>`;
  body += `<strong>Payment received via Stripe!</strong>`;
  body += `</div>\n\n`;
  body += `<h4>Customer Contact Info:</h4>`;
  body += `<p>Name: ${escapeHtml(details.customer_name || '')}</p>`;
  body += `<p>Email: ${escapeHtml(details.customer_email || '')}</p>`;
  body += `<p>Phone: ${escapeHtml(details.customer_phone || '')}</p>`;
  body += customerReceipt.body;

  const subject = `New Order: ${details.acquisition_method || 'pickup'}: ${formatDateForDisplay(details.acquisition_date)}`;

  return { subject, body };
}

async function sendEmailViaSES(ses, from, to, subject, body) {
  await ses.send(new SendEmailCommand({
    Source: from,
    Destination: { ToAddresses: Array.isArray(to) ? to : [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: body } }
    }
  }));
}

export async function onRequestPost(context) {
  const { STRIPE_SECRET_KEY, AWS_KEY, AWS_SECRET_KEY, AWS_REGION = 'us-east-1',
          CAROLINE_EMAIL_ADDRESS, DEVELOPER_EMAIL_ADDRESS } = context.env;

  if (!STRIPE_SECRET_KEY) {
    return Response.json({ error: 'STRIPE_SECRET_KEY not configured' }, { status: 500 });
  }

  try {
    const { session_id, cart, cartTotal, customerDetails, cartLines } = await context.request.json();

    if (!session_id) {
      return Response.json({ error: 'session_id is required' }, { status: 400 });
    }

    // Verify payment with Stripe
    const session = await stripeRequest(STRIPE_SECRET_KEY, 'GET', `/checkout/sessions/${session_id}`);
    const paid = session.payment_status === 'paid';
    const customerEmail = session.customer_details?.email || customerDetails?.customer_email || null;

    const products = await loadProductsFromKv(context);
    const validated = products ? buildValidatedCart(cartLines, products) : { valid: false, cart: {}, total: 0 };

    // Compare client cart to server-validated cart (best-effort)
    let cartMismatch = !validated.valid || !cart || Number(cartTotal) !== Number(validated.total);
    if (!cartMismatch) {
      const cartKeys = Object.keys(cart);
      const validatedKeys = Object.keys(validated.cart);
      if (cartKeys.length !== validatedKeys.length) {
        cartMismatch = true;
      } else {
        for (const name of validatedKeys) {
          const clientItem = cart[name];
          const serverItem = validated.cart[name];
          if (!clientItem || !serverItem) { cartMismatch = true; break; }
          if (Number(clientItem.quantity) !== Number(serverItem.quantity)) { cartMismatch = true; break; }
          if (Number(clientItem.price) !== Number(serverItem.price)) { cartMismatch = true; break; }
        }
      }
    }

    // Send order confirmation emails if payment succeeded and cart validated
    if (paid && validated.valid && !cartMismatch && customerDetails && AWS_KEY && AWS_SECRET_KEY) {
      const credentials = { accessKeyId: AWS_KEY, secretAccessKey: AWS_SECRET_KEY };
      const s3 = new S3Client({ region: AWS_REGION, credentials });
      const ses = new SESClient({ region: AWS_REGION, credentials });
      const from = 'support@sweethopebakeryy.com';

      // Replay protection: only send once per session_id
      const receiptKey = `orders/${session_id}.json`;
      let alreadySent = false;
      try {
        await s3.send(new HeadObjectCommand({ Bucket: 'sweethopebakeryy', Key: receiptKey }));
        alreadySent = true;
      } catch (err) {
        if (err?.$metadata?.httpStatusCode !== 404 && err?.name !== 'NotFound') {
          throw err;
        }
      }

      if (alreadySent) {
        return Response.json({ success: true, customerEmail });
      }

      // Update customer email from Stripe if available
      if (customerEmail) {
        customerDetails.customer_email = customerEmail;
      }

      const receipt = buildCustomerReceipt(validated.cart, validated.total, customerDetails);
      const ownerNotif = buildOwnerNotification(validated.cart, validated.total, customerDetails);

      // Send all 3 emails in parallel
      const emailPromises = [];

      // 1. Customer receipt
      if (customerEmail) {
        emailPromises.push(
          sendEmailViaSES(ses, from, customerEmail, receipt.subject, receipt.body)
            .catch(err => console.error('Customer email failed:', err))
        );
      }

      // 2. Owner notification
      if (CAROLINE_EMAIL_ADDRESS) {
        emailPromises.push(
          sendEmailViaSES(ses, from, CAROLINE_EMAIL_ADDRESS, ownerNotif.subject, ownerNotif.body)
            .catch(err => console.error('Owner email failed:', err))
        );
      }

      // 3. Developer notification
      if (DEVELOPER_EMAIL_ADDRESS) {
        emailPromises.push(
          sendEmailViaSES(ses, from, DEVELOPER_EMAIL_ADDRESS, ownerNotif.subject, ownerNotif.body)
            .catch(err => console.error('Developer email failed:', err))
        );
      }

      await Promise.all(emailPromises);

      // Mark session as processed
      await s3.send(new PutObjectCommand({
        Bucket: 'sweethopebakeryy',
        Key: receiptKey,
        Body: JSON.stringify({ session_id, sent_at: Date.now() }),
        ContentType: 'application/json'
      }));
    }

    return Response.json({
      success: paid && validated.valid && !cartMismatch,
      customerEmail
    });
  } catch (err) {
    console.error('verify-checkout error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
