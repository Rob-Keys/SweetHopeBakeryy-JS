// return.js - Return page initialization
// Replaces private/frontend/pages/return.php + Controller.php:142-162 showReturn()
// Payment verification is STUBBED until Lambda is implemented.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getCompletedOrder, clearCart, clearCustomerDetails, clearCompletedOrder, getCustomerDetails } from '../modules/cart.js';
import { didCheckoutSucceed } from '../stripe/stripe.js';
import { buildCustomerReceipt, buildOwnerNotification } from '../modules/email-receipt.js';
import { sendEmail } from '../aws/ses.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  const container = document.getElementById('return-content');
  if (!container) { renderFooter(); return; }

  // Parse session_id from URL (mirrors Controller.php:72 + stripe.php:57-58)
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');

  // Verify payment (STUBBED - returns { success: false } until Lambda)
  const result = await didCheckoutSucceed(sessionId);

  // Get completed order from localStorage (saved before payment in checkout.js)
  const completedOrder = getCompletedOrder();
  const customerDetails = getCustomerDetails();

  if (result.success && completedOrder) {
    // Store customer email from Stripe verification
    if (result.customerEmail) {
      customerDetails.customer_email = result.customerEmail;
    }

    // Render order summary (mirrors return.php:22-49)
    const cart = completedOrder.cart;
    const cartTotal = completedOrder.cart_total;

    let orderItemsHTML = '';
    for (const [name, item] of Object.entries(cart)) {
      orderItemsHTML += `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <p><strong>${item.quantity} ${name}</strong></p>
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
        <h4>A confirmation has been sent to ${customerDetails.customer_email || 'your email'}.</h4>
        <div class="alert alert-success mt-3" role="alert">
          <strong>Payment successful!</strong> We will contact you to coordinate pickup details.
        </div>
      </div>`;

    // Build and send email receipts (STUBBED via ses.sendEmail)
    // Mirrors Controller.php:669-742 send_email_receipt()
    const customerReceipt = buildCustomerReceipt(cart, cartTotal, customerDetails);
    const ownerNotification = buildOwnerNotification(cart, cartTotal, customerDetails);

    // These are all stubbed - will log warnings to console
    await sendEmail({
      from: 'support@sweethopebakeryy.com',
      to: [customerDetails.customer_email],
      subject: customerReceipt.subject,
      body: customerReceipt.body,
      date: Date.now()
    });

    // Clear cart and order data after successful display
    clearCart();
    clearCustomerDetails();
    clearCompletedOrder();
    sessionStorage.removeItem('checkout_name');
    sessionStorage.removeItem('checkout_email');
    sessionStorage.removeItem('checkout_phone');
    sessionStorage.removeItem('checkout_pickup_date');

  } else {
    // Payment verification not available or failed
    // Show order from localStorage if available, with a note about verification
    if (completedOrder) {
      const cart = completedOrder.cart;
      const cartTotal = completedOrder.cart_total;

      let orderItemsHTML = '';
      for (const [name, item] of Object.entries(cart)) {
        orderItemsHTML += `
          <li class="list-group-item d-flex justify-content-between align-items-center">
            <p><strong>${item.quantity} ${name}</strong></p>
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
          <h2>Order Submitted</h2>
          <div class="alert alert-warning mt-3" role="alert">
            <strong>Payment verification requires Lambda setup.</strong> The Stripe payment verification and email confirmation are currently stubbed. Once Lambda is implemented, this page will verify payment and send confirmation emails automatically.
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
