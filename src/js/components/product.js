// product.js - Render a product card
// Replaces private/frontend/components/product.php

/**
 * Render a product card as an HTML string.
 * Exact structure from product.php.
 * @param {Object} product - { itemName, description, imageURLs, prices, customizations }
 * @returns {string} HTML string
 */
import { escapeHtml } from '../modules/escape.js';

export function renderProduct(product) {
  const { itemName, description, imageURLs, prices, customizations } = product;
  const safeName = escapeHtml(itemName);
  const safeDescription = escapeHtml(description || '');

  // Build image slides
  const slidesHTML = imageURLs.map(url =>
    `<div class="slide"><img src="${escapeHtml(url)}" alt="${safeName} picture" class="product-image" loading="lazy" decoding="async"></div>`
  ).join('');

  // Arrows only if more than 1 image
  const arrowsHTML = imageURLs.length > 1
    ? `<button class="arrow left">&#8249;</button><button class="arrow right">&#8250;</button>`
    : '';

  // Description (only if non-empty)
  const descHTML = safeDescription ? `<h5 class="mt-2 mb-2">${safeDescription}</h5>` : '';

  // Price options sorted by quantity
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
