// menu.js - menu page initialization (product grid + cart UI).

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';
import { renderProduct } from '../components/product.js';
import { getCart, addToCart, removeFromCart, clearCart, getCartTotal, isCartEmpty } from '../modules/cart.js';
import { escapeHtml } from '../modules/escape.js';
import { showLoading, showError, showReady } from '../modules/page-state.js';

const mobileCartQuery = window.matchMedia('(max-width: 991px)');

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  initShared();
  const container = document.getElementById('products-container');
  showLoading(container, 'Loading the menu…');
  renderCartUI();
  updateCartPresentation();
  document.getElementById('checkout-btn')?.addEventListener('click', goToCheckout);
  document.getElementById('mobile-checkout-btn')?.addEventListener('click', goToCheckout);
  document.getElementById('clear-cart-btn')?.addEventListener('click', () => {
    clearCart();
    renderCartUI();
    updateCartPresentation();
  });
  mobileCartQuery.addEventListener('change', updateCartPresentation);
  if (window.ResizeObserver) {
    new ResizeObserver(updateCartPresentation).observe(document.querySelector('.cart-container-wrapper'));
  }
  loadProducts();
});

async function loadProducts() {
  const container = document.getElementById('products-container');
  showLoading(container, 'Loading the menu…');
  try {
  // ── Fetch and render products ──
  const rawProducts = await getTable('products');

  // Normalize product data (sort prices, apply defaults).
  const products = rawProducts.map(p => ({
    itemName: p.itemName,
    description: p.description || '',
    imageURLs: p.imageURLs || [],
    prices: sortPrices(p.prices || {}),
    customizations: p.customizations || {}
  }));

  // Render products in pairs per row.
  if (container) {
    let html = '';
    for (let i = 0; i < products.length - 1; i += 2) {
      html += `<div class="row cv-auto">
        <div class="col-6">${renderProduct(products[i])}</div>
        <div class="col-6">${renderProduct(products[i + 1])}</div>
      </div>`;
    }
    // Center the last product when the count is odd.
    if (products.length % 2 === 1) {
      html += `<div class="row cv-auto"><div class="col-3"></div><div class="col-6">${renderProduct(products[products.length - 1])}</div></div>`;
    }
    container.innerHTML = html;
  }
  showReady(container);
  initShared();

  // ── Add-to-cart form handlers ──
  const forms = document.querySelectorAll('.add-to-cart-form');
  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = form.querySelector('input[name="name"]').value;
      const quantityValue = form.querySelector('select[name="quantity"]').value;
      const [qty, price] = quantityValue.split('_');

      try {
        const data = await addToCart(name, qty);

        // Update cart UI.
        updateCartAfterAdd(data);

        // Show a brief confirmation toast.
        const message = document.createElement('h5');
        message.textContent = 'Added Successfully!';
        message.classList.add('fade-in-out');
        form.appendChild(message);
        requestAnimationFrame(() => {
          message.classList.add('visible');
        });
        setTimeout(() => {
          message.classList.remove('visible');
          message.addEventListener('transitionend', () => {
            if (message.parentNode) form.removeChild(message);
          });
        }, 1000);
      } catch (error) {
        console.error('Error adding to cart:', error);
        const message = document.createElement('p');
        message.className = 'text-danger';
        message.setAttribute('role', 'alert');
        message.textContent = 'This item could not be added. Please try again.';
        form.appendChild(message);
      }
    });
  });
  updateCartPresentation();
  } catch {
    showError(container, 'We could not load the menu. Please try again.', loadProducts);
  }
}

function goToCheckout() {
  if (!isCartEmpty()) window.location.href = '/checkout';
}

// ── Helper Functions ──

function sortPrices(prices) {
  const sorted = {};
  Object.keys(prices).sort((a, b) => Number(a) - Number(b)).forEach(k => {
    sorted[k] = prices[k];
  });
  return sorted;
}

/**
 * Render the full cart UI from localStorage.
 */
function renderCartUI() {
  const cart = getCart();
  const cartList = document.getElementById('cart-list');
  const totalPrice = document.getElementById('total-price');
  const mobileTotalPrice = document.getElementById('mobile-total-price');

  if (!cartList) return;

  const entries = Object.entries(cart);
  if (entries.length === 0) {
    cartList.innerHTML = `<p id="empty-cart" class="text-center mt-2 text-muted">Currently Empty</p>`;
  } else {
    cartList.innerHTML = entries.map(([name, item]) => `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <p>${escapeHtml(name)} : (${item.quantity})</p>
        <div class="d-flex justify-content-end align-items-center price-container">
          <p class="me-3 price">$${Number(item.price).toFixed(2)}</p>
          <p>
            <button type="button" class="remove-item-btn" aria-label="Remove ${escapeHtml(name)} from cart" data-name="${escapeHtml(name)}" style="color: red; background: none; border: none;"><p aria-hidden="true">X</p></button>
          </p>
        </div>
      </li>`).join('');

    // Attach remove handlers.
    cartList.querySelectorAll('.remove-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromCart(btn.dataset.name);
        renderCartUI();
        hideCartIfEmpty();
      });
    });
  }

  const total = getCartTotal();
  if (totalPrice) totalPrice.textContent = `Total: $${total.toFixed(2)}`;
  if (mobileTotalPrice) mobileTotalPrice.textContent = `Total: $${total.toFixed(2)}`;
}

/**
 * Update the cart UI after adding an item (without a full re-render).
 */
function updateCartAfterAdd(data) {
  const cartList = document.getElementById('cart-list');

  // Check if the item already exists in the DOM.
  let existing = false;
  const items = cartList.querySelectorAll('li');
  items.forEach(item => {
    for (const node of item.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.tagName.toLowerCase() === 'p') {
        const text = node.textContent.trim();
        if (text.startsWith(data.name)) {
          const qty = text.match(/\d+/);
          node.textContent = node.textContent.replace(qty[0], parseInt(qty[0]) + parseInt(data.quantity));
          existing = true;

          // Update price.
          const priceContainer = item.querySelector('.price');
          if (priceContainer) {
            const oldPrice = parseFloat(priceContainer.textContent.replace(/[^\d.-]/g, ''));
            const newPrice = oldPrice + parseFloat(data.price);
            priceContainer.textContent = '$' + newPrice.toFixed(2);
          }
        }
      }
    }
  });

  if (!existing) {
    const newItemHTML = `
      <li class="list-group-item d-flex justify-content-between align-items-center">
        <p>${escapeHtml(data.name)} : (${data.quantity})</p>
        <div class="d-flex justify-content-end align-items-center price-container">
          <p class="me-3 price">$${parseFloat(data.price).toFixed(2)}</p>
          <p>
            <button type="button" class="remove-item-btn" aria-label="Remove ${escapeHtml(data.name)} from cart" data-name="${escapeHtml(data.name)}" style="color: red; background: none; border: none;"><p aria-hidden="true">X</p></button>
          </p>
        </div>
      </li>`;
    cartList.insertAdjacentHTML('beforeend', newItemHTML);

    // Attach remove handler to new item.
    const lastBtn = cartList.querySelector('li:last-child .remove-item-btn');
    if (lastBtn) {
      lastBtn.addEventListener('click', () => {
        removeFromCart(lastBtn.dataset.name);
        renderCartUI();
        hideCartIfEmpty();
      });
    }

    const lastElement = cartList.lastElementChild;
    if (window.innerWidth < 991) {
      cartList.scrollTop = cartList.scrollHeight;
    } else {
      lastElement.style.animation = 'fadeIn 0.6s ease';
    }

    // Remove the "Currently Empty" placeholder.
    const emptyCart = document.getElementById('empty-cart');
    if (emptyCart) {
      emptyCart.remove();
      makeCartVisible();
    }
  }

  // Update totals.
  const total = getCartTotal();
  const totalPrice = document.getElementById('total-price');
  const mobileTotalPrice = document.getElementById('mobile-total-price');
  if (totalPrice) totalPrice.textContent = `Total: $${total.toFixed(2)}`;
  if (mobileTotalPrice) mobileTotalPrice.textContent = `Total: $${total.toFixed(2)}`;
}

/** Recalculate mobile cart visibility and reserve space after it opens. */
function hideCartIfEmpty() {
  updateCartPresentation();
}

function makeCartVisible() {
  updateCartPresentation();
}

function updateCartPresentation() {
  const wrapper = document.querySelector('.cart-container-wrapper');
  const open = !isCartEmpty();
  wrapper?.classList.toggle('cart-open', open);
  if (mobileCartQuery.matches && open && wrapper) {
    document.body.style.paddingBottom = `${Math.ceil(wrapper.getBoundingClientRect().height + 16)}px`;
  } else {
    document.body.style.paddingBottom = '';
  }
}
