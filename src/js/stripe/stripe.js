// stripe.js - Stripe checkout flow
// Session creation and verification call Cloudflare Pages Functions at /api/*

import { buildLineItems, getCartLines } from '../modules/cart.js';

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
    const response = await fetch('/api/rate/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cartLines })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const clientSecret = data.clientSecret || data.client_secret || data.checkoutSessionClientSecret || null;
    if (!clientSecret) throw new Error('Missing checkout client secret');
    return clientSecret;
  } catch (err) {
    console.error('createStripeCheckout failed:', err);
    return null;
  }
}

/**
 * Fetch Stripe publishable key from server (keeps mode/account in sync with secret key).
 * @returns {Promise<string|null>} publishable key or null on failure
 */
async function fetchStripePublicKey() {
  try {
    const response = await fetch('/api/rate/get-stripe-public-key');
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
 * @param {Object} cart - Cart data { "Product Name": { quantity, price } }
 * @param {number} cartTotal - Total amount
 * @param {Object} customerDetails - Customer info { customer_name, customer_email, ... }
 * @returns {Promise<{success: boolean, customerEmail: string|null}>}
 */
async function didCheckoutSucceed(sessionId, cart, cartTotal, customerDetails) {
  try {
    const cartLines = getCartLines();
    const response = await fetch('/api/rate/verify-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        cart,
        cartTotal,
        customerDetails,
        cartLines
      })
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('didCheckoutSucceed failed:', err);
    return { success: false, customerEmail: null };
  }
}

export { prepareCheckoutSession, createStripeCheckout, didCheckoutSucceed, fetchStripePublicKey };
