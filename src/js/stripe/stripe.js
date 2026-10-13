// stripe.js - client wrappers for Stripe checkout via Pages Functions.

import { buildLineItems, getCartLines } from '../modules/cart.js';

const CHECKOUT_ATTEMPT_KEY = 'shb_checkout_attempt';
let cachedAttemptFingerprint = null;
let cachedIdempotencyKey = null;

function getCheckoutIdempotencyKey(cartLines) {
  const fingerprint = JSON.stringify(cartLines);
  if (fingerprint === cachedAttemptFingerprint && cachedIdempotencyKey) return cachedIdempotencyKey;

  const now = Date.now();
  try {
    const stored = JSON.parse(sessionStorage.getItem(CHECKOUT_ATTEMPT_KEY) || 'null');
    if (stored?.fingerprint === fingerprint &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored.key || '') &&
        now - Number(stored.createdAt) < 20 * 60 * 60 * 1000) {
      cachedAttemptFingerprint = fingerprint;
      cachedIdempotencyKey = stored.key;
      return stored.key;
    }
  } catch {
    // Generate an in-memory key when browser storage is unavailable.
  }

  if (!globalThis.crypto?.randomUUID) throw new Error('Secure checkout initialization is unavailable.');
  const key = crypto.randomUUID();
  cachedAttemptFingerprint = fingerprint;
  cachedIdempotencyKey = key;
  try {
    sessionStorage.setItem(CHECKOUT_ATTEMPT_KEY, JSON.stringify({ fingerprint, key, createdAt: now }));
  } catch {
    // The key remains stable for automatic retries in this page instance.
  }
  return key;
}

/**
 * Prepare line items for display on checkout page. Fully client-side.
 * @returns {Array} Stripe-format line items
 */
function prepareCheckoutSession() {
  return buildLineItems();
}

/**
 * Create a Stripe Checkout session via Pages Function.
 * @returns {Promise<string|null>} clientSecret or null on failure
 */
async function createStripeCheckout() {
  try {
    const cartLines = getCartLines();
    const idempotencyKey = getCheckoutIdempotencyKey(cartLines);
    const response = await fetch('/api/rate/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartLines, idempotencyKey })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const clientSecret = data.clientSecret || data.client_secret || data.checkoutSessionClientSecret || null;
    if (!clientSecret || !data.sessionId) throw new Error('Missing checkout session details');
    if (!data.cart || !Number.isSafeInteger(data.amountTotal)) {
      throw new Error('Missing server-priced order summary');
    }
    return {
      clientSecret,
      sessionId: data.sessionId || null,
      order: {
        cart: data.cart,
        cart_total: data.amountTotal / 100
      },
      amountTotal: data.amountTotal
    };
  } catch (err) {
    console.error('createStripeCheckout failed:', err);
    return null;
  }
}

async function saveCheckoutDetails(sessionId, customerDetails) {
  const response = await fetch('/api/rate/update-checkout-details', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, customerDetails })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.saved) {
    throw new Error(data?.error || `Unable to save order details (HTTP ${response.status})`);
  }
  return true;
}

/**
 * Fetch Stripe publishable key from server (keeps mode/account in sync with secret key).
 * @returns {Promise<string|null>} publishable key or null on failure
 */
async function fetchStripePublicKey() {
  try {
    const response = await fetch('/api/public/get-stripe-public-key');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.publicKey || data.stripePublicKey || null;
  } catch (err) {
    console.warn('fetchStripePublicKey failed:', err);
    return null;
  }
}

/**
 * Verify that a Stripe checkout succeeded and trigger server-side emails.
 * @param {string} sessionId - Stripe checkout session ID
 * Customer and pickup details are loaded from the server-side session snapshot.
 * @returns {Promise<{success: boolean, customerEmail: string|null}>}
 */
async function didCheckoutSucceed(sessionId) {
  try {
    const response = await fetch('/api/rate/verify-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        success: false,
        paymentState: data?.paymentState || 'temporarily_unavailable',
        customerEmail: null,
        error: data?.error || data?.message || `HTTP ${response.status}`
      };
    }
    return data;
  } catch (err) {
    console.error('didCheckoutSucceed failed:', err);
    return {
      success: false,
      paymentState: 'temporarily_unavailable',
      customerEmail: null,
      error: err?.message || 'Verification failed'
    };
  }
}

export {
  prepareCheckoutSession,
  createStripeCheckout,
  saveCheckoutDetails,
  didCheckoutSucceed,
  fetchStripePublicKey
};
