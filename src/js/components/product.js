// product.js - renders a product card.

/**
 * Render a product card as an HTML string.
 * @param {Object} product - { itemName, description, imageURLs, prices, customizations }
 * @returns {string} HTML string
 */
import { escapeHtml } from '../modules/escape.js';

export function renderProduct(product) {
  const { itemName, description, imageURLs, prices, customizations } = product;
  const safeName = escapeHtml(itemName);
  const safeDescription = escapeHtml(description || '');

  // Build the image slider markup.
  const slidesHTML = imageURLs.map(url =>
    `<div class="slide"><img src="${escapeHtml(url)}" alt="${safeName} picture" class="product-image" loading="lazy" decoding="async"></div>`
  ).join('');

  // Only show arrows when multiple images are available.
  const arrowsHTML = imageURLs.length > 1
    ? `<button class="arrow left">&#8249;</button><button class="arrow right">&#8250;</button>`
    : '';

  // Include description only when provided.
  const descHTML = safeDescription ? `<h5 class="mt-2 mb-2">${safeDescription}</h5>` : '';

  // Sort price options by quantity for a stable UI order.
  const sortedPrices = Object.entries(prices).sort(([a], [b]) => Number(a) - Number(b));
  const optionsHTML = sortedPrices.map(([qty, price]) =>
    `<option value="${qty}_${price}" style="font-family: sans-serif">${qty} for $${Number(price).toFixed(2)}</option>`
  ).join('');

  return `
    <div class="product-card cv-auto mb-4 p-3 rounded fade-in-up">
      <h3 class="product-name">${safeName}</h3>
      <div class="slider-container">
        <div class="slider-wrapper">${slidesHTML}</div>
        ${arrowsHTML}
      </div>
      ${descHTML}
      <form class="add-to-cart-form">
        <input type="hidden" name="name" value="${safeName}">
        <div class="mb-2 product-quantity"><label>Quantity:</label>
          <select name="quantity" class="form-select d-inline-block w-auto product-select">${optionsHTML}</select>
        </div>
        <input type="hidden" name="action" value="add">
        <button type="submit" class="btn btn-lg btn-cookie">Add to Cart</button>
      </form>
    </div>`;
}
