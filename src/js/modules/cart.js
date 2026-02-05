// cart.js - localStorage-backed cart state and checkout payload helpers.

import { getTable } from './database.js';

const CART_KEY = 'shb_cart';
const CUSTOMER_KEY = 'shb_customer';
const COMPLETED_ORDER_KEY = 'shb_completed_order';

// Cart operations.

function getCartStore() {
  const stored = localStorage.getItem(CART_KEY);
  if (!stored) return { lines: [], summary: {} };
  try {
    const parsed = JSON.parse(stored);
    if (parsed && Array.isArray(parsed.lines) && parsed.summary && typeof parsed.summary === 'object') {
      return parsed;
    }
    if (parsed && typeof parsed === 'object') {
      // Back-compat: summary-only map from older format; reset to avoid price mismatch.
      return { lines: [], summary: {} };
    }
  } catch {
    // Ignore parse errors and fall back to an empty cart.
  }
  return { lines: [], summary: {} };
}

function saveCartStore(store) {
  localStorage.setItem(CART_KEY, JSON.stringify(store));
}

function getCart() {
  return getCartStore().summary;
}

/**
 * Add item to the cart using the latest catalog price.
 * @param {string} name - Product name
 * @param {string} quantityKey - The quantity key (e.g. "6") to look up in product prices
 * @returns {Promise<{name, quantity, price}>} - The item added (for UI feedback)
 */
async function addToCart(name, quantityKey) {
  const menuItem = await getTable('products', name);
  if (!menuItem) throw new Error(`Product not found: ${name}`);

  const price = menuItem.prices[quantityKey];
  if (price === undefined) throw new Error(`Price not found for ${name} qty ${quantityKey}`);

  const store = getCartStore();
  const cart = store.summary;
  const qty = parseInt(quantityKey);

  if (cart[name]) {
    cart[name].quantity += qty;
    cart[name].price += price;
  } else {
    cart[name] = { quantity: qty, price };
  }

  store.lines.push({ name, quantityKey: String(quantityKey) });
  saveCartStore(store);
  return { name, quantity: quantityKey, price };
}

function removeFromCart(name) {
  const store = getCartStore();
  const cart = store.summary;
  delete cart[name];
  store.lines = store.lines.filter(line => line.name !== name);
  saveCartStore(store);
}

function clearCart() {
  localStorage.removeItem(CART_KEY);
}

function getCartTotal() {
  const cart = getCart();
  return Object.values(cart).reduce((total, item) => total + item.price, 0);
}

function isCartEmpty() {
  return Object.keys(getCart()).length === 0;
}

// Line items for Stripe.

function buildLineItems() {
  const cart = getCart();
  return Object.entries(cart).map(([name, item]) => ({
    price_data: {
      currency: 'usd',
      product_data: { name },
      unit_amount: item.price * 100, // cents
    },
    quantity: 1,
    actual_quantity: item.quantity,
  }));
}

function getCartLines() {
  return getCartStore().lines;
}

// Customer details.

function saveCustomerDetails(details) {
  localStorage.setItem(CUSTOMER_KEY, JSON.stringify(details));
}

function getCustomerDetails() {
  const stored = localStorage.getItem(CUSTOMER_KEY);
  return stored ? JSON.parse(stored) : {};
}

function clearCustomerDetails() {
  localStorage.removeItem(CUSTOMER_KEY);
}

// Completed order snapshot (saved before Stripe redirect, used on return page).

function saveCompletedOrder() {
  const cart = getCart();
  const cartTotal = getCartTotal();
  localStorage.setItem(COMPLETED_ORDER_KEY, JSON.stringify({ cart, cart_total: cartTotal }));
}

function getCompletedOrder() {
  const stored = localStorage.getItem(COMPLETED_ORDER_KEY);
  return stored ? JSON.parse(stored) : null;
}

function clearCompletedOrder() {
  localStorage.removeItem(COMPLETED_ORDER_KEY);
}

export {
  getCart, addToCart, removeFromCart, clearCart,
  getCartTotal, isCartEmpty, buildLineItems, getCartLines,
  saveCustomerDetails, getCustomerDetails, clearCustomerDetails,
  saveCompletedOrder, getCompletedOrder, clearCompletedOrder
};
