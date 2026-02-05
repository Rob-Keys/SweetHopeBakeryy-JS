// checkout.js - Checkout page initialization

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { isCartEmpty, buildLineItems, getCartLines, saveCustomerDetails, saveCompletedOrder } from '../modules/cart.js';
import { createStripeCheckout, fetchStripePublicKey } from '../stripe/stripe.js';
import config from '../modules/config.js';

const STRIPE_SCRIPT_SRC = 'https://js.stripe.com/clover/stripe.js';
const STRIPE_SCRIPT_ATTR = 'data-stripe-loader';
const STRIPE_RETRY_MAX = 3;
const STRIPE_RETRY_BASE_DELAY = 800;
let stripeScriptPromise = null;

function loadStripeScript() {
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (stripeScriptPromise) return stripeScriptPromise;

  stripeScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = STRIPE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.setAttribute(STRIPE_SCRIPT_ATTR, 'true');
    script.onload = () => {
      if (window.Stripe) {
        resolve(window.Stripe);
      } else {
        reject(new Error('Stripe failed to initialize.'));
      }
    };
    script.onerror = () => reject(new Error('Stripe failed to load.'));
    document.head.appendChild(script);
  }).catch((err) => {
    stripeScriptPromise = null;
    document.querySelector(`script[${STRIPE_SCRIPT_ATTR}]`)?.remove();
    throw err;
  });

  return stripeScriptPromise;
}

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

  const setUserError = (el, message) => {
    if (el) el.textContent = message || '';
  };

  const debugLog = (message, error) => {
    if (typeof globalThis.__debugLog !== 'function') return;
    if (error) {
      globalThis.__debugLog(message, error);
    } else {
      globalThis.__debugLog(message);
    }
  };

  const emailErrors = document.getElementById('email-errors');
  const phoneErrors = document.getElementById('phone-errors');
  const errors = document.getElementById('confirm-errors');
  const payButton = document.getElementById('pay-button');
  const paymentEl = document.getElementById('payment-element');

  let checkout = null;
  let checkoutActions = null;
  let stripeInitInFlight = false;
  let stripeInitAttempts = 0;
  let stripeInitComplete = false;

  const setPaymentStatus = (message, type = 'info', showRetry = false) => {
    if (!paymentEl) return;
    const safeMessage = message || '';
    const retryButton = showRetry
      ? '<button type="button" class="btn btn-sm btn-cookie" data-stripe-retry="true">Retry</button>'
      : '';
    paymentEl.innerHTML = `
      <div class="alert alert-${type} mt-2 d-flex justify-content-between align-items-center gap-2">
        <div>${safeMessage}</div>
        ${retryButton}
      </div>`;
    const retry = paymentEl.querySelector('[data-stripe-retry="true"]');
    retry?.addEventListener('click', () => {
      stripeInitAttempts = 0;
      initStripeCheckout({ manual: true });
    });
  };

  setPaymentStatus('Loading secure payment form...');
  if (payButton) {
    payButton.disabled = true;
    payButton.setAttribute('aria-busy', 'true');
  }

  payButton?.addEventListener('click', async (e) => {
    if (e && e.defaultPrevented) return;

    // Clear previous errors
    setUserError(errors, '');
    setUserError(phoneErrors, '');
    setUserError(emailErrors, '');

    // Validate name
    const nameValue = (nameInput?.value || '').trim();
    if (!nameValue) {
      setUserError(errors, 'Please enter your name.');
      nameInput?.focus();
      return;
    }

    // Validate email (from stripe/checkout.js:57-63)
    const emailValue = (emailInput?.value || '').trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailValue)) {
      setUserError(emailErrors, 'Please enter a valid email address.');
      emailInput?.focus();
      return;
    }

    // Validate phone (from stripe/checkout.js:65-72)
    const phoneValue = phoneInput?.value || '';
    const digitCount = (phoneValue.match(/\d/g) || []).length;
    if (digitCount < 10) {
      setUserError(phoneErrors, 'Please enter a valid phone number with at least 10 digits.');
      phoneInput?.focus();
      return;
    }

    // Validate pickup date
    const dateValue = pickupDateInput?.value || '';
    if (!dateValue) {
      setUserError(errors, 'Please select a pickup date.');
      pickupDateInput?.focus();
      return;
    }

    const selectedDate = new Date(dateValue);
    const minDate = new Date();
    minDate.setDate(minDate.getDate() + 2);
    if (selectedDate < minDate) {
      setUserError(errors, 'Pickup date must be at least 3 days from today.');
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
    if (checkoutActions) {
      try {
        const result = await checkoutActions.confirm();
        if (result.type === 'error') {
          debugLog('Stripe confirm error:', result.error || result);
          setUserError(errors, 'We couldn’t process your payment. Please check your payment details and try again.');
        }
      } catch (confirmErr) {
        debugLog('Stripe confirm exception:', confirmErr);
        setUserError(errors, 'We couldn’t complete your payment. Please try again or contact support@sweethopebakeryy.com.');
      }
    } else {
      setUserError(errors, 'Payment processing is temporarily unavailable. Please try again later.');
    }
  });

  const initStripeCheckout = async ({ manual = false } = {}) => {
    if (stripeInitComplete || stripeInitInFlight) return;
    stripeInitInFlight = true;
    stripeInitAttempts += 1;
    setPaymentStatus(manual ? 'Retrying secure payment form...' : 'Loading secure payment form...');
    try {
      await loadStripeScript();

      // Prefer server-provided publishable key to avoid mode/account mismatches
      const serverPublicKey = await fetchStripePublicKey();
      const stripePublicKey = serverPublicKey || config.stripePublicKey;
      if (!stripePublicKey) {
        throw new Error('Missing Stripe publishable key.');
      }

      const stripe = Stripe(stripePublicKey);
      const clientSecret = await createStripeCheckout();
      if (!clientSecret) {
        throw new Error('Missing checkout client secret.');
      }

      // clover build: initCheckout is synchronous, returns checkout object immediately
      checkout = stripe.initCheckout({ clientSecret });

      // Mount payment element (works before loadActions)
      if (paymentEl) paymentEl.innerHTML = '';
      const paymentElement = checkout.createPaymentElement();
      paymentElement.mount('#payment-element');

      // Load actions (needed for updateEmail, confirm, etc.)
      const loadResult = await checkout.loadActions();
      if (loadResult.type === 'error') {
        throw new Error(loadResult.error?.message || 'Failed to load checkout');
      }
      checkoutActions = loadResult.actions;
      stripeInitComplete = true;

      if (payButton) {
        payButton.disabled = false;
        payButton.removeAttribute('aria-busy');
      }

      // Email validation on blur
      emailInput?.addEventListener('blur', async () => {
        if (checkoutActions?.updateEmail) {
          const result = await checkoutActions.updateEmail(emailInput.value);
          if (result?.error) {
            setUserError(emailErrors, 'Please enter a valid email address.');
          }
        }
      });
    } catch (err) {
      debugLog('Stripe checkout initialization failed:', err);
      checkout = null;
      checkoutActions = null;
      if (stripeInitAttempts < STRIPE_RETRY_MAX) {
        const delay = STRIPE_RETRY_BASE_DELAY * Math.pow(2, stripeInitAttempts - 1);
        setPaymentStatus('Still loading payment form... retrying in a moment.', 'warning');
        setTimeout(() => initStripeCheckout(), delay);
      } else {
        setPaymentStatus(
          'Payment processing is temporarily unavailable. Please try again or contact us at support@sweethopebakeryy.com.',
          'danger',
          true
        );
      }
      if (payButton) {
        payButton.disabled = true;
        payButton.removeAttribute('aria-busy');
      }
    } finally {
      stripeInitInFlight = false;
    }
  };

  renderFooter();
  initShared();

  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => initStripeCheckout(), { timeout: 2000 });
  } else {
    setTimeout(() => initStripeCheckout(), 0);
  }
});
