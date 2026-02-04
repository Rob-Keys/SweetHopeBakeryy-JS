// checkout.js - Checkout page initialization

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { isCartEmpty, buildLineItems, getCartLines, saveCustomerDetails, saveCompletedOrder } from '../modules/cart.js';
import { createStripeCheckout } from '../stripe/stripe.js';
import config from '../modules/config.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Cart guard: redirect if empty (mirrors Controller.php:100-103)
  if (isCartEmpty()) {
    window.location.href = '/menu';
    return;
  }

  // ── Render order summary (mirrors checkout.php:40-53) ──
  const lineItems = buildLineItems();
  const summaryList = document.getElementById('order-summary-list');
  const orderTotal = document.getElementById('order-total');

  if (summaryList) {
    let total = 0;
    summaryList.innerHTML = lineItems.map(item => {
      const amount = item.price_data.unit_amount / 100;
      total += amount;
      return `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <p><strong>${item.actual_quantity} ${item.price_data.product_data.name}</strong></p>
          <p>$${amount.toFixed(2)}</p>
        </li>`;
    }).join('');
    if (orderTotal) orderTotal.textContent = `Total: $${total.toFixed(2)}`;
  }

  // ── Form field persistence via sessionStorage (from public/js/checkout.js:10-48) ──
  const nameInput = document.getElementById('name');
  const emailInput = document.getElementById('email');
  const phoneInput = document.getElementById('phone');
  const pickupDateInput = document.getElementById('pickup-date');

  if (nameInput && sessionStorage.getItem('checkout_name')) nameInput.value = sessionStorage.getItem('checkout_name');
  if (emailInput && sessionStorage.getItem('checkout_email')) emailInput.value = sessionStorage.getItem('checkout_email');
  if (phoneInput && sessionStorage.getItem('checkout_phone')) phoneInput.value = sessionStorage.getItem('checkout_phone');
  if (pickupDateInput && sessionStorage.getItem('checkout_pickup_date')) pickupDateInput.value = sessionStorage.getItem('checkout_pickup_date');

  nameInput?.addEventListener('input', (e) => sessionStorage.setItem('checkout_name', e.target.value));
  emailInput?.addEventListener('input', (e) => sessionStorage.setItem('checkout_email', e.target.value));
  phoneInput?.addEventListener('input', (e) => sessionStorage.setItem('checkout_phone', e.target.value));
  pickupDateInput?.addEventListener('change', (e) => sessionStorage.setItem('checkout_pickup_date', e.target.value));

  // Set minimum date to 3 days from today (from public/js/checkout.js:3-8)
  if (pickupDateInput) {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 3);
    pickupDateInput.min = minDate.toISOString().split('T')[0];
  }

  const cartLines = getCartLines();
  if (!cartLines.length) {
    const paymentEl = document.getElementById('payment-element');
    if (paymentEl) {
      paymentEl.innerHTML = `<div class="alert alert-warning mt-2">Your cart needs to be refreshed. Please return to the menu and add your items again.</div>`;
    }
    renderFooter();
    initShared();
    return;
  }

  // ── Stripe integration (from public/js/stripe/checkout.js) ──
  // Get public key from config (replaces fetch('/get_stripe_public_key'))
  const stripe = Stripe(config.stripePublicKey);

  const fetchClientSecret = async () => {
    const clientSecret = await createStripeCheckout();
    return clientSecret;
  };

  let checkout = null;
  try {
    checkout = await stripe.initCheckout({ fetchClientSecret });
  } catch (err) {
    console.error('Stripe checkout initialization failed:', err.message);
    const paymentEl = document.getElementById('payment-element');
    if (paymentEl) {
      paymentEl.innerHTML = `<div class="alert alert-danger mt-2">Payment processing is temporarily unavailable. Please try again later or contact us at support@sweethopebakeryy.com.</div>`;
    }
  }

  if (checkout) {
    // Mount payment element
    const paymentElement = checkout.createPaymentElement();
    paymentElement.mount('#payment-element');

    // Email validation on blur (from stripe/checkout.js:28-35)
    const emailErrors = document.getElementById('email-errors');
    emailInput?.addEventListener('blur', () => {
      checkout.updateEmail(emailInput.value).then((result) => {
        if (result.error) {
          emailErrors.textContent = result.error.message;
        }
      });
    });
  }

  // ── Pay button handler (from stripe/checkout.js:38-115) ──
  const payButton = document.getElementById('pay-button');
  const errors = document.getElementById('confirm-errors');
  const emailErrors = document.getElementById('email-errors');
  const phoneErrors = document.getElementById('phone-errors');

  payButton?.addEventListener('click', async (e) => {
    if (e && e.defaultPrevented) return;

    // Clear previous errors
    if (errors) errors.textContent = '';
    if (phoneErrors) phoneErrors.textContent = '';
    if (emailErrors) emailErrors.textContent = '';

    // Validate name
    const nameValue = (nameInput?.value || '').trim();
    if (!nameValue) {
      if (errors) errors.textContent = 'Please enter your name.';
      nameInput?.focus();
      return;
    }

    // Validate email (from stripe/checkout.js:57-63)
    const emailValue = (emailInput?.value || '').trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue)) {
      if (emailErrors) emailErrors.textContent = 'Please enter a valid email address.';
      emailInput?.focus();
      return;
    }

    // Validate phone (from stripe/checkout.js:65-72)
    const phoneValue = phoneInput?.value || '';
    const digitCount = (phoneValue.match(/\d/g) || []).length;
    if (digitCount < 10) {
      if (phoneErrors) phoneErrors.textContent = 'Please enter a valid phone number with at least 10 digits.';
      phoneInput?.focus();
      return;
    }

    // Validate pickup date
    const dateValue = pickupDateInput?.value || '';
    if (!dateValue) {
      if (errors) errors.textContent = 'Please select a pickup date.';
      pickupDateInput?.focus();
      return;
    }

    const selectedDate = new Date(dateValue);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 2);
    if (selectedDate < minDate) {
      if (errors) errors.textContent = 'Pickup date must be at least 3 days from today.';
      pickupDateInput?.focus();
      return;
    }

    // Save customer details to localStorage (replaces POST to /saveCustomerDetails)
    const acquisitionMethod = document.querySelector('input[name="acquisition_method"]')?.value || 'pickup';
    const deliveryAddress = document.getElementById('delivery-address')?.value || '';

    saveCustomerDetails({
      customer_name: nameValue,
      customer_email: emailValue,
      customer_phone: phoneValue,
      acquisition_date: dateValue,
      acquisition_method: acquisitionMethod,
      delivery_address: deliveryAddress
    });

    // Save order snapshot before payment redirect (for return page)
    saveCompletedOrder();

    // Confirm payment with Stripe
    if (checkout) {
      checkout.confirm().then((result) => {
        if (result.type === 'error') {
          if (errors) errors.textContent = result.error.message;
        }
      });
    } else {
      if (errors) errors.textContent = 'Payment processing is temporarily unavailable. Please try again later.';
    }
  });

  renderFooter();
  initShared();
});
