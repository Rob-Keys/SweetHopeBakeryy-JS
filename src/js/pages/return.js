// return.js - post-checkout confirmation page.
// Verifies payment status and renders the order summary.
// Emails are sent server-side by verify-checkout.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import {
  getCompletedOrder,
  clearCart,
  clearCustomerDetails,
  clearCompletedOrder,
  getCustomerDetails,
  getCart,
  getCartTotal,
  getCartLines
} from '../modules/cart.js';
import { didCheckoutSucceed } from '../stripe/stripe.js';
import { escapeHtml } from '../modules/escape.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  const container = document.getElementById('return-content');
  if (!container) { renderFooter(); return; }

  // Parse session_id from URL.
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  // Load the completed order snapshot saved before payment.
  let completedOrder = getCompletedOrder();
  const customerDetails = getCustomerDetails();

  // Fallback: reconstruct from cart storage if the snapshot is missing.
  if (!completedOrder) {
    const cart = getCart();
    if (cart && Object.keys(cart).length > 0) {
      completedOrder = {
        cart,
        cart_total: getCartTotal(),
        cartLines: getCartLines()
      };
    }
  }

  // Fallback: fetch short-lived snapshot from the server (cross-origin return URLs).
  if (!completedOrder && sessionId) {
    try {
      const response = await fetch(`/api/rate/get-order?session_id=${encodeURIComponent(sessionId)}`);
      if (response.ok) {
        completedOrder = await response.json();
      }
    } catch (err) {
      console.warn('Return page fallback order fetch failed:', err);
    }
  }

  // Verify payment and trigger server-side emails.
  const result = await didCheckoutSucceed(
    sessionId,
    completedOrder?.cart,
    completedOrder?.cart_total,
    customerDetails,
    completedOrder?.cartLines
  );
  if (result?.error && typeof globalThis.__debugLog === 'function') {
    globalThis.__debugLog('verify-checkout error:', result.error);
  }

  if (result.success && completedOrder) {
    const customerEmail = escapeHtml(result.customerEmail || customerDetails.customer_email || 'your email');

    // Render order summary.
    const cart = completedOrder.cart;
    const cartTotal = completedOrder.cart_total;

    let orderItemsHTML = '';
    for (const [name, item] of Object.entries(cart)) {
      orderItemsHTML += `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <p><strong>${item.quantity} ${escapeHtml(name)}</strong></p>
          <p>$${Number(item.price).toFixed(2)}</p>
        </li>`;
    }

    container.innerHTML = `
      <div class="col-md-5 fade-in-right">
        <div class="card">
          <div class="card-header">
            <h2>Order Summary</h2>
          </div>
          <ul class="list-group list-group-flush">
            ${orderItemsHTML}
          </ul>
          <div class="card-body">
            <h5 class="card-title">Total: $${Number(cartTotal).toFixed(2)}</h5>
          </div>
        </div>
      </div>
      <div class="col-md-1"></div>
      <div class="col-md-5 fade-in-left">
        <h2>Thanks for your order!</h2>
        <h4>A confirmation has been sent to ${customerEmail}.</h4>
        <div class="alert alert-success mt-3" role="alert">
          <strong>Payment successful!</strong> We will contact you to coordinate pickup details.
        </div>
      </div>`;

    // Clear cart and order data after successful display.
    clearCart();
    clearCustomerDetails();
    clearCompletedOrder();
    sessionStorage.removeItem('checkout_name');
    sessionStorage.removeItem('checkout_email');
    sessionStorage.removeItem('checkout_phone');
    sessionStorage.removeItem('checkout_pickup_date');

  } else {
    // Payment verification not available or failed.
    if (completedOrder) {
      const cart = completedOrder.cart;
      const cartTotal = completedOrder.cart_total;

      let orderItemsHTML = '';
      for (const [name, item] of Object.entries(cart)) {
        orderItemsHTML += `
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <p><strong>${item.quantity} ${escapeHtml(name)}</strong></p>
            <p>$${Number(item.price).toFixed(2)}</p>
          </li>`;
      }

      container.innerHTML = `
        <div class="col-md-5 fade-in-right">
          <div class="card">
            <div class="card-header">
              <h2>Order Summary</h2>
            </div>
            <ul class="list-group list-group-flush">
              ${orderItemsHTML}
            </ul>
            <div class="card-body">
              <h5 class="card-title">Total: $${Number(cartTotal).toFixed(2)}</h5>
            </div>
          </div>
        </div>
        <div class="col-md-1"></div>
        <div class="col-md-5 fade-in-left">
          <h2>Order Failed</h2>
          <div class="alert alert-warning mt-3" role="alert">
            <strong>Payment verification failed.</strong> We could not confirm your payment. If you were charged, please contact us at support@sweethopebakeryy.com and we will resolve this.
          </div>
        </div>`;
    } else {
      container.innerHTML = `
        <div class="col-12">
          <div class="alert alert-info">
            <h4>No order data found.</h4>
            <p>If you just completed a payment, the order data may have been cleared. <a href="/menu">Return to menu</a>.</p>
          </div>
        </div>`;
    }
  }

  renderFooter();
  initShared();
});
