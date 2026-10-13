// return.js - post-checkout payment status and order recovery.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import {
  getCompletedOrder,
  clearCart,
  clearCustomerDetails,
  clearCompletedOrder,
  getCart,
  getCartTotal,
  getCartLines
} from '../modules/cart.js';
import { didCheckoutSucceed } from '../stripe/stripe.js';
import { escapeHtml } from '../modules/escape.js';

let sharedContentInitialized = false;

function finalizeContent() {
  renderFooter();
  if (!sharedContentInitialized) {
    initShared();
    sharedContentInitialized = true;
  }
}

function renderOrderSummary(order) {
  if (!order?.cart || typeof order.cart !== 'object') return '';
  const orderItemsHTML = Object.entries(order.cart).map(([name, item]) => `
    <li class="list-group-item d-flex justify-content-between align-items-center">
      <p><strong>${Number(item.quantity)} ${escapeHtml(name)}</strong></p>
      <p>$${Number(item.price).toFixed(2)}</p>
    </li>`).join('');
  return `
    <div class="col-md-5 fade-in-right">
      <div class="card">
        <div class="card-header"><h2>Order Summary</h2></div>
        <ul class="list-group list-group-flush">${orderItemsHTML}</ul>
        <div class="card-body">
          <h5 class="card-title">Total: $${Number(order.cart_total).toFixed(2)}</h5>
        </div>
      </div>
    </div>`;
}

function renderReference(sessionId) {
  return sessionId
    ? `<p class="small">Order reference: <code>${escapeHtml(sessionId)}</code></p>`
    : '';
}

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();

  const container = document.getElementById('return-content');
  if (!container) {
    finalizeContent();
    return;
  }
  container.setAttribute('aria-busy', 'true');
  container.innerHTML = '<div class="col-12"><p class="page-status" role="status">Confirming your order…</p></div>';
  confirmOrder(container);
});

async function confirmOrder(container) {
  container.setAttribute('aria-busy', 'true');
  try {

  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  let completedOrder = getCompletedOrder();

  if (!completedOrder) {
    const cart = getCart();
    if (cart && Object.keys(cart).length > 0) {
      completedOrder = { cart, cart_total: getCartTotal(), cartLines: getCartLines() };
    }
  }

  if (!completedOrder && sessionId) {
    try {
      const response = await fetch(`/api/rate/get-order?session_id=${encodeURIComponent(sessionId)}`);
      if (response.ok) completedOrder = await response.json();
    } catch (err) {
      console.warn('Return page fallback order fetch failed:', err);
    }
  }

  const renderStatus = (result) => {
    const order = result?.success && result.cart
      ? { cart: result.cart, cart_total: result.cartTotal }
      : completedOrder;
    const summary = renderOrderSummary(order);
    const reference = renderReference(sessionId);

    if (result?.success) {
      const customerEmail = escapeHtml(result.customerEmail || 'your email');
      const deliveryMessage = result.customerEmailSent && result.notificationStatus === 'sent'
        ? `A confirmation email was sent to ${customerEmail}.`
        : result.notificationStatus === 'unknown'
          ? 'Your payment is confirmed. We could not verify the email status for this order; contact us if you need another confirmation.'
          : 'Your payment is confirmed. We are still processing the email confirmation.';
      container.innerHTML = `
        ${summary}<div class="col-md-1"></div>
        <div class="col-md-5 fade-in-left">
          <h2>Thanks for your order!</h2>
          <p>${deliveryMessage}</p>
          <div class="alert alert-success mt-3" role="status">
            <strong>Payment successful.</strong> We will contact you to coordinate pickup details.
          </div>
          ${reference}
        </div>`;
      clearCart();
      clearCustomerDetails();
      clearCompletedOrder();
      sessionStorage.removeItem('shb_checkout_attempt');
      sessionStorage.removeItem('checkout_name');
      sessionStorage.removeItem('checkout_email');
      sessionStorage.removeItem('checkout_phone');
      sessionStorage.removeItem('checkout_pickup_date');
      return;
    }

    const state = result?.paymentState || 'temporarily_unavailable';
    const messages = {
      processing: {
        heading: 'Payment processing',
        body: 'Stripe has not confirmed payment yet. This page will not start another payment. Check again in a moment; if you see a charge, contact support with your order reference.'
      },
      unpaid: {
        heading: 'Payment not completed',
        body: 'Stripe reports that payment was not completed. If you see a charge, contact support with your order reference before trying again.'
      },
      review: {
        heading: 'Payment received, order needs review',
        body: 'Your payment was received, but the order details could not be matched automatically. Please contact support with this order reference.'
      },
      temporarily_unavailable: {
        heading: 'Checking payment status',
        body: 'We could not reach the payment service just now. Your order is being kept while we check again. Do not submit another payment.'
      }
    };
    const status = messages[state] || messages.temporarily_unavailable;
    const canRetry = Boolean(sessionId && ['processing', 'temporarily_unavailable'].includes(state));
    container.innerHTML = `
      ${summary}<div class="col-md-1"></div>
      <div class="col-md-5 fade-in-left">
        <h2>${status.heading}</h2>
        <div class="alert alert-warning mt-3" role="status">${status.body}</div>
        ${reference}
        ${canRetry ? '<button type="button" class="btn-cookie btn-lg mt-2" id="verify-retry">Check payment status</button>' : ''}
      </div>`;

    document.getElementById('verify-retry')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.textContent = 'Checking payment status…';
      container.setAttribute('aria-busy', 'true');
      const retryResult = await didCheckoutSucceed(sessionId);
      container.removeAttribute('aria-busy');
      renderStatus(retryResult);
    });
  };

  if (!sessionId) {
    container.innerHTML = `
      <div class="col-12"><div class="alert alert-info" role="status">
        <h4>No checkout session was provided.</h4>
        <p>If you just completed a payment, contact support@sweethopebakeryy.com before placing another order. <a href="/menu">Return to menu</a>.</p>
      </div></div>`;
  } else {
    renderStatus(await didCheckoutSucceed(sessionId));
  }

  container.removeAttribute('aria-busy');
  finalizeContent();
  } catch {
    container.removeAttribute('aria-busy');
    container.innerHTML = '<div class="col-12"><div class="alert alert-warning" role="alert"><p>We could not confirm your order right now. Please refresh this page or contact support@sweethopebakeryy.com if you were charged.</p><button type="button" class="btn btn-cookie" id="retry-verification">Retry verification</button></div></div>';
    container.querySelector('#retry-verification')?.addEventListener('click', () => confirmOrder(container), { once: true });
    finalizeContent();
  }
}
