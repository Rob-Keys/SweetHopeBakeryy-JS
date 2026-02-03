// stripe.js - Stripe checkout flow (partially stubbed)
// Replaces private/backend/stripe/stripe.php
// Line item preparation is fully client-side.
// Session creation and verification require STRIPE_SECRET_KEY -> stubbed for Lambda.

import config from '../modules/config.js';
import { buildLineItems } from '../modules/cart.js';

/**
 * Prepare line items for display on checkout page. Fully client-side.
 * Mirrors stripe.php:19-32 create_checkout_session()
 * @returns {Array} Stripe-format line items
 */
function prepareCheckoutSession() {
  return buildLineItems();
}

/**
 * STUBBED: Create a Stripe Checkout session.
 * Mirrors stripe.php:34-54 create_stripe_checkout()
 *
 * TODO: Implement as Lambda function.
 * Lambda should:
 *   1. Receive { lineItems: [...], returnUrl: "..." } from the client
 *   2. Use STRIPE_SECRET_KEY to call stripe.checkout.sessions.create({
 *        line_items: lineItems (without actual_quantity),
 *        mode: 'payment',
 *        ui_mode: 'custom',
 *        return_url: returnUrl
 *      })
 *   3. Return { clientSecret: session.client_secret }
 *
 * Client will call:
 *   const response = await fetch('https://<api-gateway>/create-checkout', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ lineItems, returnUrl: config.returnUrl })
 *   });
 *   const { clientSecret } = await response.json();
 *   return clientSecret;
 *
 * @returns {Promise<string|null>} clientSecret or null if stubbed
 */
async function createStripeCheckout() {
  console.warn('createStripeCheckout STUBBED - requires Lambda with STRIPE_SECRET_KEY');
  return null;
}

/**
 * STUBBED: Verify that a Stripe checkout succeeded.
 * Mirrors stripe.php:56-67 did_checkout_succeed()
 *
 * TODO: Implement as Lambda function.
 * Lambda should:
 *   1. Receive { sessionId } from the client
 *   2. Use STRIPE_SECRET_KEY to call stripe.checkout.sessions.retrieve(sessionId)
 *   3. Check session.payment_status === 'paid'
 *   4. Return { success: true/false, customerEmail: session.customer_details.email }
 *
 * Client will call:
 *   const response = await fetch(`https://<api-gateway>/verify-checkout?session_id=${sessionId}`);
 *   const { success, customerEmail } = await response.json();
 *   return { success, customerEmail };
 *
 * @param {string} sessionId - Stripe checkout session ID
 * @returns {Promise<{success: boolean, customerEmail: string|null}>}
 */
async function didCheckoutSucceed(sessionId) {
  console.warn('didCheckoutSucceed STUBBED - requires Lambda with STRIPE_SECRET_KEY');
  return { success: false, customerEmail: null };
}

export { prepareCheckoutSession, createStripeCheckout, didCheckoutSucceed };
