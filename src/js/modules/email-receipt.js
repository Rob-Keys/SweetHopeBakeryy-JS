// email-receipt.js - Build email receipt HTML for order confirmations

import config from './config.js';

/**
 * Format an ISO date (YYYY-MM-DD) to MM-DD-YYYY for display.
 * Mirrors Controller.php:662-667 formatDateForDisplay()
 * @param {string} isoDate
 * @returns {string}
 */
function formatDateForDisplay(isoDate) {
  if (!isoDate) return '';
  const dt = new Date(isoDate + 'T00:00:00'); // Avoid timezone shift
  if (isNaN(dt.getTime())) return isoDate;
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
}

/**
 * Escape HTML special characters (mirrors PHP htmlspecialchars)
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Format a dollar amount to 2 decimal places.
 */
function formatPrice(amount) {
  return Number(amount).toFixed(2);
}

/**
 * Build customer receipt email. Mirrors Controller.php:674-696.
 * @param {Object} cart - { "Product Name": { quantity, price }, ... }
 * @param {number} cartTotal
 * @param {Object} details - { customer_name, customer_phone, customer_email, acquisition_date, acquisition_method, delivery_address }
 * @returns {{ subject: string, body: string }}
 */
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
    body += `<p>${escapeHtml(config.pickupAddress)}</p>`;
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

/**
 * Build owner notification email. Mirrors Controller.php:707-740.
 * @param {Object} cart
 * @param {number} cartTotal
 * @param {Object} details
 * @returns {{ subject: string, body: string }}
 */
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

export { buildCustomerReceipt, buildOwnerNotification, formatDateForDisplay };
