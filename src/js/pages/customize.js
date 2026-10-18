// customize.js - admin customize page initialization.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared, ImageSlider } from '../shared.js';
import { isAuthenticated, setDesiredPage } from '../modules/auth.js';
import { getTable, putItem, removeItem } from '../modules/database.js';
import { uploadImages, deleteImages } from '../aws/s3.js';
import { renderPageSectionEditor, renderLocalCodeAgentPanel } from '../components/customize-page.js';
import { escapeHtml } from '../modules/escape.js';
import { initLocalCodeAgentHandlers } from '../modules/luna-agent.js';
import { showError } from '../modules/page-state.js';

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();

  // Auth guard: redirect to login if session is missing.
  if (!isAuthenticated()) {
    setDesiredPage('/customize');
    window.location.href = '/authenticate';
    return;
  }

  loadCustomize();
});

let lunaPanel;

function showCommitPending(result) {
  const version = document.getElementById('deployment-version');
  if (version && result?.commit) {
    version.textContent = `Saved in ${result.commit.slice(0, 7)}. Live site updates after the deploy finishes.`;
  }
}

async function loadCustomize() {
  const container = document.getElementById('customize-content');
  if (!container) return;
  if (!lunaPanel) {
    container.innerHTML = renderLocalCodeAgentPanel();
    lunaPanel = container.firstElementChild;
    initLocalCodeAgentHandlers();
  } else {
    container.replaceChildren(lunaPanel);
  }
  const loadingStatus = document.createElement('p');
  loadingStatus.className = 'page-status';
  loadingStatus.setAttribute('role', 'status');
  loadingStatus.textContent = 'Loading editor data…';
  container.setAttribute('aria-busy', 'true');
  container.append(loadingStatus);
  try {
  // Fetch all editable data.
  const tableNames = ['products', 'home_page', 'about_page', 'contact_page'];
  const tableResults = await Promise.allSettled([
    getTable('products'),
    getTable('home_page'),
    getTable('about_page'),
    getTable('contact_page')
  ]);
  const tableData = Object.fromEntries(tableNames.map((name, index) => [
    name,
    tableResults[index].status === 'fulfilled' && Array.isArray(tableResults[index].value) ? tableResults[index].value : []
  ]));
  const tableErrors = Object.fromEntries(tableNames.map((name, index) => [name, tableResults[index].status === 'rejected' ? tableResults[index].reason : null]));
  const errorMessage = (error) => error instanceof Error ? error.message : String(error || 'Unknown error');
  const { products, home_page: homeSections, about_page: aboutSections, contact_page: contactSections } = tableData;

  // Sort sections by index.
  homeSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  aboutSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  contactSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Normalize section shape for the editor.
  const formatSections = (sections) => sections.map(s => ({
    sectionIndex: s.sectionIndex,
    headerText: s.headerText || '',
    bodyText: s.bodyText || '',
    imageURL: s.imageURLs ? s.imageURLs[0] : '',
    imageURLs: s.imageURLs || []
  }));

  // ── Render product editor ──
  let html = `<div class="m-5">
    <h1 class="subtitle">Customize Site</h1>
    <p class="text-muted small" id="deployment-version">Commit: loading…</p>
    <div id="luna-panel-mount"></div>
    ${tableErrors.products ? `<div class="alert alert-danger">Could not load menu data: ${escapeHtml(errorMessage(tableErrors.products))} <button type="button" class="btn btn-sm btn-cookie" data-retry-editor>Retry</button></div>` : ''}
    <h2 class="subtitle">Edit Menu</h2>
    <p>Set each menu option as a quantity and a price. For example, add one option for 6 cookies at $10 and another for 12 at $15.</p>
    <p>"Customizations" currently dont do anything and you can just leave that field blank for now.</p>
    <p>I recommend uploading images that are of filetype .avif, as theyre most efficient size-wise and will make your site load faster. To convert a .png or .jpg to .avif you can use a site like: <a href="https://cloudinary.com/tools/jpg-to-avif" target="_blank" rel="noopener noreferrer">JPEG-To-Avif Converter</a></p>
    <div class="row menu-row">
      <div class="col-2"><h5>Product Name</h5></div>
      <div class="col-2"><h5>Description</h5></div>
      <div class="col-2"><h5>Price options</h5></div>
      <div class="col-2"><h5>Customizations</h5></div>
      <div class="col-2"><h5>Image</h5></div>
      <div class="col-2 right-align"><h5>Actions</h5></div>
    </div>`;

  // Product rows.
  products.forEach((product, i) => {
    const pricesStr = Object.entries(product.prices || {}).map(([q, p]) => `${q}:${p}`).join(', ');
    const customStr = Object.entries(product.customizations || {}).map(([c, p]) => `${c}:${p}`).join(', ');
    const imageURLs = product.imageURLs || [];
    const safeItemName = escapeHtml(product.itemName);
    const safeDescription = escapeHtml(product.description || '');
    const safePricesStr = escapeHtml(pricesStr);
    const safeCustomStr = escapeHtml(customStr);

    // Slides for view mode.
    const slidesHTML = imageURLs.map(url =>
      `<div class="slide"><img src="${escapeHtml(url)}" alt="${safeItemName} picture" class="product-image" loading="lazy" decoding="async"></div>`
    ).join('');
    const arrowsHTML = imageURLs.length > 1
      ? `<button class="arrow left">&#8249;</button><button class="arrow right">&#8250;</button>`
      : '';

    // Edit mode images.
    const editImagesHTML = imageURLs.map(url => `
      <div class="edit-image-item" data-image-url="${escapeHtml(url)}">
        <img src="${escapeHtml(url)}" alt="Product image" class="edit-product-image" style="width: 80px; height: 80px; object-fit: cover;" loading="lazy" decoding="async">
        <button type="button" class="btn btn-sm btn-danger remove-image-btn" aria-label="Remove product image">&times;</button>
      </div>`).join('');

    html += `
    <div class="row menu-row" data-item-index="${i}">
      <!-- View Mode -->
      <div class="col-2 view-mode"><p>${safeItemName}</p></div>
      <div class="col-2 view-mode"><p>${safeDescription}</p></div>
      <div class="col-2 view-mode"><p>${safePricesStr}</p></div>
      <div class="col-2 view-mode"><p>${safeCustomStr}</p></div>
      <!-- Edit Mode -->
      <div class="col-2 edit-mode" style="display: none;">
          <textarea class="form-control edit-itemName" aria-label="Product name" rows="4">${safeItemName}</textarea>
        <input type="hidden" class="original-itemName" value="${safeItemName}">
      </div>
      <div class="col-2 edit-mode" style="display: none;">
        <textarea class="form-control edit-description" aria-label="Product description" rows="4">${safeDescription}</textarea>
      </div>
      <div class="col-2 edit-mode price-options-field" style="display: none;">
        ${renderPriceOptionsEditor(product.prices || {})}
      </div>
      <div class="col-2 edit-mode" style="display: none;">
        <textarea class="form-control edit-customizations" rows="4">${safeCustomStr}</textarea>
      </div>
      <div class="col-2">
        <div class="slider-container view-mode">
          <div class="slider-wrapper">${slidesHTML}</div>
          ${arrowsHTML}
        </div>
        <div class="edit-mode" style="display: none;">
          <div class="edit-images-container">${editImagesHTML}</div>
          <label class="editor-field-label">Add product images</label>
          <input type="file" class="form-control mt-2 add-images-input" aria-label="Add product images" multiple accept="image/*">
          <small class="text-muted">Add new images or remove existing ones</small>
        </div>
      </div>
      <div class="col-2 right-align">
        <button type="button" class="btn btn-cookie button-2 mt-2 edit-item-btn">Edit Item</button>
        <button type="button" class="btn btn-success button-2 mt-2 save-edits-btn" style="display: none;">Save Edits</button>
        <form class="remove-item-form">
          <input type="hidden" name="tableName" value="products">
          <input type="hidden" name="partitionKey" value="itemName">
          <input type="hidden" name="partitionKeyValue" value="${safeItemName}">
          <button type="submit" class="btn btn-danger button-2 mt-2">Remove Item</button>
        </form>
      </div>
    </div>`;
  });

  // Add new product form.
  if (!tableErrors.products) html += `
    <form class="row menu-row add-product-form">
      <div class="col-2"><label class="editor-field-label">Product name</label><textarea rows="4" name="partitionKeyValue" placeholder="Product Name" required></textarea></div>
      <div class="col-2"><label class="editor-field-label">Description</label><textarea rows="4" name="description" placeholder="Product description"></textarea></div>
      <div class="col-2 price-options-field">
        ${renderPriceOptionsEditor({})}
      </div>
      <div class="col-2"><textarea rows="4" name="csvCustomizations" placeholder="cstm: price, cstm: price, ..."></textarea></div>
      <div class="col-2"><label class="editor-field-label">Product images</label><input type="file" name="images[]" aria-label="Product images" multiple accept="image/*" required></div>
      <div class="col-2 right-align">
        <input type="hidden" name="tableName" value="products">
        <input type="hidden" name="partitionKey" value="itemName">
        <button type="submit" class="btn btn-cookie button-2 mt-2">Add Item</button>
      </div>
    </form>`;
  html += '</div>';

  // Temporarily disabled at the user's request; restore this line to show the live site preview:
  // import { renderSitePreview } from '../components/customize-page.js';
  // ${renderSitePreview(products, homeSections, aboutSections, contactSections)}

  // Page section editors.
  for (const [tableName, sections] of [['home_page', homeSections], ['about_page', aboutSections], ['contact_page', contactSections]]) {
    html += tableErrors[tableName]
      ? `<div class="alert alert-danger">Could not load ${escapeHtml(tableName)} content: ${escapeHtml(errorMessage(tableErrors[tableName]))} <button type="button" class="btn btn-sm btn-cookie" data-retry-editor>Retry</button></div>`
      : renderPageSectionEditor(formatSections(sections), tableName);
  }

  container.innerHTML = html;
  container.removeAttribute('aria-busy');
  container.querySelector('#luna-panel-mount')?.replaceWith(lunaPanel);
  container.querySelectorAll('[data-retry-editor]').forEach((button) => {
    button.addEventListener('click', loadCustomize, { once: true });
  });

  const deploymentVersion = container.querySelector('#deployment-version');
  if (deploymentVersion) {
    fetch('/api/deployment-version', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(({ commit }) => {
        deploymentVersion.textContent = `Commit: ${commit || 'unknown'}`;
      })
      .catch((error) => {
        deploymentVersion.textContent = `Commit: unavailable (${error.message})`;
      });
  }

  // ── Event handlers ──
  initProductEditHandlers();
  initPriceOptionsEditors();
  initSectionEditHandlers();
  initRemoveHandlers();
  initAddHandlers();
  initShared();
  } catch (error) {
    showError(container, `Could not load editor data: ${error instanceof Error ? error.message : String(error || 'Unknown error')}`, loadCustomize);
    container.append(lunaPanel);
  }
}

function ensureRowStatus(row) {
  if (!row) return null;
  let status = row.querySelector('.row-status');
  if (!status) {
    const actionCol = row.querySelector('.right-align');
    if (!actionCol) return null;
    status = document.createElement('div');
    status.className = 'row-status mt-2 w-100';
    status.style.alignSelf = 'stretch';
    actionCol.appendChild(status);
  }
  return status;
}

function setRowStatus(row, message, type = 'info') {
  const status = ensureRowStatus(row);
  if (!status) return;
  status.innerHTML = '';
  if (!message) return;
  const alert = document.createElement('div');
  alert.className = `alert alert-${type} py-1 px-2 mb-0`;
  alert.textContent = message;
  status.appendChild(alert);
}

function setButtonBusy(button, busy, busyLabel = 'Saving...') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalLabel) {
      button.dataset.originalLabel = button.textContent || '';
    }
    button.textContent = busyLabel;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.originalLabel !== undefined) {
      button.textContent = button.dataset.originalLabel;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

function hideElements(elements) {
  elements.forEach(el => { el.style.display = 'none'; });
}

function showElements(elements) {
  elements.forEach(el => { el.style.removeProperty('display'); });
}

function parsePrices(value) {
  const input = String(value || '').trim();
  if (!input) throw new Error('At least one price option is required.');

  const prices = {};
  for (const entry of input.split(',')) {
    const parts = entry.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid price option "${entry.trim()}". Use quantity: price.`);
    }

    const [quantity, priceText] = parts.map(part => part.trim());
    if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) {
      throw new Error(`Invalid quantity "${quantity}". Quantities must be positive whole numbers.`);
    }
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(priceText)) {
      throw new Error(`Invalid price "${priceText}". Prices must be positive dollar amounts with up to two decimal places.`);
    }

    const price = Number(priceText);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Invalid price "${priceText}". Prices must be greater than zero.`);
    }
    if (Object.hasOwn(prices, quantity)) {
      throw new Error(`Quantity "${quantity}" appears more than once.`);
    }
    prices[quantity] = price;
  }
  return prices;
}

function renderPriceOptionsEditor(prices) {
  const entries = Object.entries(prices || {});
  const rows = (entries.length ? entries : [['', '']]).map(([quantity, price]) => `
    <div class="price-option-row">
      <label>Quantity <input class="price-quantity" type="number" min="1" step="1" inputmode="numeric" value="${escapeHtml(quantity)}" placeholder="6"></label>
      <label>Price ($) <input class="price-amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(price)}" placeholder="10.00"></label>
      <button type="button" class="btn btn-sm btn-outline-danger remove-price-option" aria-label="Remove price option">Remove</button>
    </div>`).join('');
  return `<div class="price-options-editor">
    <div class="price-option-list">${rows}</div>
    <button type="button" class="btn btn-sm btn-outline-secondary add-price-option">+ Add price option</button>
    <small class="text-muted">Choose the quantity and its total price.</small>
  </div>`;
}

function readPriceOptions(editor) {
  const values = Array.from(editor.querySelectorAll('.price-option-row')).map((row) => {
    const quantity = row.querySelector('.price-quantity')?.value.trim() || '';
    const price = row.querySelector('.price-amount')?.value.trim() || '';
    if (!quantity && !price) return null;
    if (!quantity || !price) throw new Error('Enter both a quantity and a price for each option.');
    return `${quantity}:${price}`;
  }).filter(Boolean);
  return parsePrices(values.join(', '));
}

function initPriceOptionsEditors() {
  document.querySelectorAll('.price-options-editor').forEach((editor) => {
    const list = editor.querySelector('.price-option-list');
    editor.addEventListener('click', (event) => {
      const addButton = event.target.closest('.add-price-option');
      const removeButton = event.target.closest('.remove-price-option');
      if (addButton) {
        const row = document.createElement('div');
        row.className = 'price-option-row';
        row.innerHTML = '<label>Quantity <input class="price-quantity" type="number" min="1" step="1" inputmode="numeric" placeholder="12"></label><label>Price ($) <input class="price-amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="15.00"></label><button type="button" class="btn btn-sm btn-outline-danger remove-price-option" aria-label="Remove price option">Remove</button>';
        list.append(row);
        row.querySelector('.price-quantity')?.focus();
      }
      if (removeButton) {
        const rows = list.querySelectorAll('.price-option-row');
        if (rows.length === 1) {
          rows[0].querySelectorAll('input').forEach((input) => { input.value = ''; });
          rows[0].querySelector('.price-quantity')?.focus();
        } else {
          removeButton.closest('.price-option-row')?.remove();
        }
      }
    });
  });
}

function buildSlidesHTML(imageURLs, itemName) {
  const safeName = escapeHtml(itemName || '');
  return imageURLs.map(url =>
    `<div class="slide"><img src="${escapeHtml(url)}" alt="${safeName} picture" class="product-image" loading="lazy" decoding="async"></div>`
  ).join('');
}

function updateProductView(row, { itemName, description, pricesText, customText, imageURLs }) {
  const viewCols = row.querySelectorAll('.col-2.view-mode');
  if (viewCols[0]) viewCols[0].querySelector('p')?.replaceChildren(document.createTextNode(itemName || ''));
  if (viewCols[1]) viewCols[1].querySelector('p')?.replaceChildren(document.createTextNode(description || ''));
  if (viewCols[2]) viewCols[2].querySelector('p')?.replaceChildren(document.createTextNode(pricesText || ''));
  if (viewCols[3]) viewCols[3].querySelector('p')?.replaceChildren(document.createTextNode(customText || ''));

  const sliderContainer = row.querySelector('.slider-container.view-mode');
  if (sliderContainer) {
    const slidesHTML = buildSlidesHTML(imageURLs, itemName);
    const arrowsHTML = imageURLs.length > 1
      ? `<button class="arrow left">&#8249;</button><button class="arrow right">&#8250;</button>`
      : '';
    sliderContainer.innerHTML = `<div class="slider-wrapper">${slidesHTML}</div>${arrowsHTML}`;
    if (imageURLs.length > 1) {
      new ImageSlider(sliderContainer);
    }
  }
}

function rebuildEditImages(row, imageURLs, onRemove) {
  const container = row.querySelector('.edit-images-container');
  if (!container) return;
  container.innerHTML = '';
  if (!imageURLs.length) {
    const empty = document.createElement('small');
    empty.className = 'text-muted';
    empty.textContent = 'No image currently set';
    container.appendChild(empty);
    return;
  }
  imageURLs.forEach(url => {
    const item = document.createElement('div');
    item.className = 'edit-image-item';
    item.dataset.imageUrl = url;

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Product image';
    img.className = 'edit-product-image';
    img.style.width = '80px';
    img.style.height = '80px';
    img.style.objectFit = 'cover';
    img.loading = 'lazy';
    img.decoding = 'async';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-danger remove-image-btn';
    btn.textContent = '×';
    btn.setAttribute('aria-label', 'Remove image');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onRemove(url, item);
    });

    item.appendChild(img);
    item.appendChild(btn);
    container.appendChild(item);
  });
}

function getImageUploadKeys(directory, files) {
  const supportedExtensions = new Set(['avif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'ico']);
  return files.map(file => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !supportedExtensions.has(extension)) {
      throw new Error(`Unsupported image format for “${file.name}”. Use AVIF, JPG, PNG, WebP, or GIF.`);
    }
    return `${directory}/${crypto.randomUUID()}.${extension}`;
  });
}

// ── Product edit/save handlers ──
function initProductEditHandlers() {
  const menuRows = document.querySelectorAll('.menu-row[data-item-index]');
  menuRows.forEach(row => {
    const editBtn = row.querySelector('.edit-item-btn');
    const saveBtn = row.querySelector('.save-edits-btn');
    const viewModeElements = row.querySelectorAll('.view-mode');
    const editModeElements = row.querySelectorAll('.edit-mode');
    let imagesToRemove = [];

    const bindRemoveButtons = () => {
      row.querySelectorAll('.remove-image-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const imageItem = btn.closest('.edit-image-item');
          if (!imageItem) return;
          imagesToRemove.push(imageItem.dataset.imageUrl);
          imageItem.remove();
        });
      });
    };

    bindRemoveButtons();

    editBtn?.addEventListener('click', () => {
      imagesToRemove = [];
      hideElements(viewModeElements);
      showElements(editModeElements);
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    });

    saveBtn?.addEventListener('click', async () => {
      if (saveBtn?.dataset.saving === 'true') return;
      saveBtn.dataset.saving = 'true';
      setRowStatus(row, 'Saving...', 'info');
      setButtonBusy(saveBtn, true);
      if (editBtn) editBtn.disabled = true;
      const itemName = row.querySelector('.edit-itemName')?.value.trim();
      const originalItemName = row.querySelector('.original-itemName')?.value;
      const description = row.querySelector('.edit-description')?.value;
      const priceEditor = row.querySelector('.price-options-editor');
      const customizations = row.querySelector('.edit-customizations')?.value;

      let parsedPrices;

      // Parse customizations.
      const parsedCustom = {};
      if (customizations) {
        customizations.split(',').forEach(pair => {
          const [c, p] = pair.split(':').map(s => s.trim());
          if (c && p) parsedCustom[c] = p;
        });
      }

      // Build current image URLs from remaining DOM elements (minus removed).
      const currentImageURLs = Array.from(row.querySelectorAll('.edit-image-item'))
        .map(el => el.dataset.imageUrl);

      try {
        if (!itemName) throw new Error('Product name is required.');
        parsedPrices = readPriceOptions(priceEditor);

        // Upload new images and collect their public URLs.
        let newImageURLs = [];
        const newImagesInput = row.querySelector('.add-images-input');
        if (newImagesInput?.files?.length > 0) {
          const files = Array.from(newImagesInput.files);
          const filenames = getImageUploadKeys('products', files);
          const result = await uploadImages(filenames, files);
          if (!result.success) {
            throw new Error(result.error || 'Failed to upload images.');
          }
          if (result.urls) {
            newImageURLs = result.urls;
          }
        }

        const imageURLs = [...currentImageURLs, ...newImageURLs];
        const saveResult = await putItem('products', {
          itemName,
          description,
          prices: parsedPrices,
          customizations: parsedCustom,
          imageURLs
        }, { previousKey: originalItemName });
        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Save failed.');
        }
        showCommitPending(saveResult);

        // Delete removed images only after the catalog no longer references them.
        if (imagesToRemove.length > 0) {
          const s3Keys = imagesToRemove.map(url => {
            try { return new URL(url).pathname.replace(/^\//, ''); } catch { return url; }
          });
          const deleteResult = await deleteImages(s3Keys);
          if (!deleteResult.success) {
            console.warn('Product saved, but removed images could not be deleted:', deleteResult.error);
          }
        }

        // Update view mode with new values.
        const pricesText = Object.entries(parsedPrices).map(([q, p]) => `${q}:${p}`).join(', ');
        const customText = Object.entries(parsedCustom).map(([c, p]) => `${c}:${p}`).join(', ');
        updateProductView(row, { itemName, description, pricesText, customText, imageURLs });

        // Update hidden fields for future edits/removals.
        const originalNameInput = row.querySelector('.original-itemName');
        if (originalNameInput) originalNameInput.value = itemName || '';
        const removeKeyInput = row.querySelector('.remove-item-form [name="partitionKeyValue"]');
        if (removeKeyInput) removeKeyInput.value = itemName || '';

        // Refresh edit images to match saved state.
        rebuildEditImages(row, imageURLs, (url, item) => {
          imagesToRemove.push(url);
          item.remove();
        });
        imagesToRemove = [];

        // Switch back to view mode.
        showElements(viewModeElements);
        hideElements(editModeElements);
        editBtn.style.display = 'inline-block';
        saveBtn.style.display = 'none';
        const fileInput = row.querySelector('.add-images-input');
        if (fileInput) fileInput.value = '';
        setRowStatus(row, 'Saved. Live site updates after the deploy finishes.', 'success');
        setTimeout(() => setRowStatus(row, ''), 3000);
      } catch (err) {
        console.error('Product save failed:', err);
        setRowStatus(row, err?.message || 'Save failed.', 'danger');
      } finally {
        saveBtn.dataset.saving = 'false';
        setButtonBusy(saveBtn, false);
        if (editBtn) editBtn.disabled = false;
      }
    });
  });
}

// ── Section edit/save handlers ──
function initSectionEditHandlers() {
  const sectionRows = document.querySelectorAll('.menu-row[data-section-index]');
  sectionRows.forEach(row => {
    const editBtn = row.querySelector('.edit-section-btn');
    const saveBtn = row.querySelector('.save-section-btn');
    const viewModeElements = row.querySelectorAll('.view-mode');
    const editModeElements = row.querySelectorAll('.edit-mode');
    const pageName = row.dataset.pageName;
    let imageToRemove = null;

    const removeImageBtn = row.querySelector('.remove-image-btn');
    if (removeImageBtn) {
      removeImageBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const imageItem = removeImageBtn.closest('.edit-image-item');
        imageToRemove = imageItem.dataset.imageUrl;
        imageItem.remove();
      });
    }

    editBtn?.addEventListener('click', () => {
      imageToRemove = null;
      hideElements(viewModeElements);
      showElements(editModeElements);
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    });

    saveBtn?.addEventListener('click', async () => {
      if (saveBtn?.dataset.saving === 'true') return;
      saveBtn.dataset.saving = 'true';
      setRowStatus(row, 'Saving...', 'info');
      setButtonBusy(saveBtn, true);
      if (editBtn) editBtn.disabled = true;
      const sectionIndex = row.querySelector('.edit-sectionIndex')?.value;
      const headerTextEl = row.querySelector('.edit-headerText');
      const headerText = headerTextEl ? headerTextEl.value : '';
      const bodyText = row.querySelector('.edit-bodyText')?.value;

      // Start with existing images, minus any removed.
      const existingImages = row.dataset.imageUrls ? JSON.parse(row.dataset.imageUrls) : [];
      let currentImageURLs = imageToRemove
        ? existingImages.filter(url => url !== imageToRemove)
        : [...existingImages];

      try {
        // Upload new images.
        let newImageURLs = [];
        const newImageInput = row.querySelector('.add-images-input');
        if (newImageInput?.files?.length > 0) {
          const files = Array.from(newImageInput.files);
          const filenames = getImageUploadKeys(pageName, files);
          const result = await uploadImages(filenames, files);
          if (!result.success) {
            throw new Error(result.error || 'Failed to upload image.');
          }
          if (result.urls) {
            newImageURLs = result.urls;
          }
        }

        const imageURLs = [...currentImageURLs, ...newImageURLs];
        const saveResult = await putItem(pageName, {
          sectionIndex,
          headerText,
          bodyText,
          imageURLs
        });
        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Save failed.');
        }
        showCommitPending(saveResult);

        // Delete the old image only after the saved section no longer references it.
        if (imageToRemove) {
          try {
            const imageUrl = new URL(imageToRemove);
            const s3Key = decodeURIComponent(imageUrl.pathname.replace(/^\//, ''));
            const deleteResult = await deleteImages([s3Key]);
            if (!deleteResult.success) {
              console.warn('Section saved, but removed image could not be deleted:', deleteResult.error);
            }
          } catch {
            // Local image path; skip S3 deletion.
          }
        }

        // Update view mode text.
        const viewCols = row.querySelectorAll('.view-mode');
        const viewIndex = viewCols[0]?.querySelector('p');
        if (viewIndex) viewIndex.textContent = sectionIndex || '';
        let viewOffset = 1;
        if (row.querySelector('.edit-headerText')) {
          const viewHeader = viewCols[1]?.querySelector('p');
          if (viewHeader) viewHeader.textContent = headerText || '';
          viewOffset = 2;
        }
        const viewBody = viewCols[viewOffset]?.querySelector('p');
        if (viewBody) viewBody.textContent = bodyText || '';

        // Update view mode image, including the empty state when the image was removed.
        const imagePreview = row.querySelector('.section-image-preview');
        if (imagePreview) {
          imagePreview.replaceChildren();
          if (imageURLs[0]) {
            const img = document.createElement('img');
            img.className = 'demo-photo';
            img.src = imageURLs[0];
            img.alt = "Section's associated image";
            img.loading = 'lazy';
            img.decoding = 'async';
            imagePreview.append(img);
          } else {
            const empty = document.createElement('div');
            empty.className = 'site-preview-image-empty';
            empty.textContent = 'No image set';
            imagePreview.append(empty);
          }
        }

        // Update stored image URLs for next edit.
        row.dataset.imageUrls = JSON.stringify(imageURLs);
        imageToRemove = null;

        // Refresh edit images.
        rebuildEditImages(row, imageURLs, (url, item) => {
          imageToRemove = url;
          item.remove();
        });

        // Switch back to view mode.
        showElements(viewModeElements);
        hideElements(editModeElements);
        editBtn.style.display = 'inline-block';
        saveBtn.style.display = 'none';
        const fileInput = row.querySelector('.add-images-input');
        if (fileInput) fileInput.value = '';
        setRowStatus(row, 'Saved. Live site updates after the deploy finishes.', 'success');
        setTimeout(() => setRowStatus(row, ''), 3000);
      } catch (err) {
        console.error('Section save failed:', err);
        setRowStatus(row, err?.message || 'Save failed.', 'danger');
      } finally {
        saveBtn.dataset.saving = 'false';
        setButtonBusy(saveBtn, false);
        if (editBtn) editBtn.disabled = false;
      }
    });
  });
}

// ── Remove handlers ──
function initRemoveHandlers() {
  // Remove product.
  document.querySelectorAll('.remove-item-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tableName = form.querySelector('[name="tableName"]').value;
      const key = form.querySelector('[name="partitionKeyValue"]').value;
      const submitButton = form.querySelector('[type="submit"]');
      setRowStatus(form, 'Removing item...', 'info');
      setButtonBusy(submitButton, true, 'Removing...');
      const result = await removeItem(tableName, key);
      if (result.success) {
        showCommitPending(result);
        form.closest('.menu-row')?.remove();
      } else {
        setRowStatus(form, result.error || 'Could not remove item.', 'danger');
        setButtonBusy(submitButton, false);
      }
    });
  });

  // Remove section.
  document.querySelectorAll('.remove-section-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tableName = form.querySelector('[name="tableName"]').value;
      const key = form.querySelector('[name="partitionKeyValue"]').value;
      const submitButton = form.querySelector('[type="submit"]');
      setRowStatus(form, 'Removing section...', 'info');
      setButtonBusy(submitButton, true, 'Removing...');
      const result = await removeItem(tableName, key);
      if (result.success) {
        showCommitPending(result);
        form.closest('.menu-row')?.remove();
      } else {
        setRowStatus(form, result.error || 'Could not remove section.', 'danger');
        setButtonBusy(submitButton, false);
      }
    });
  });
}

// ── Add handlers ──
function initAddHandlers() {
  // Add product.
  document.querySelector('.add-product-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.querySelector('[name="partitionKeyValue"]').value.trim();
    const description = form.querySelector('[name="description"]')?.value || '';
    const csvCustomizations = form.querySelector('[name="csvCustomizations"]')?.value || '';
    if (!name) return;

    const submitButton = form.querySelector('[type="submit"]');
    setRowStatus(form, 'Adding product...', 'info');
    setButtonBusy(submitButton, true, 'Adding...');

    // Parse customizations.
    const customizations = {};
    csvCustomizations.split(',').forEach(pair => {
      const [c, p] = pair.split(':').map(s => s.trim());
      if (c && p) customizations[c] = p;
    });

    try {
      const prices = readPriceOptions(form.querySelector('.price-options-editor'));

      // Upload images before saving, so an upload failure cannot create a product
      // record with missing image URLs.
      let imageURLs = [];
      const imageInput = form.querySelector('[name="images[]"]');
      if (imageInput?.files?.length > 0) {
        const files = Array.from(imageInput.files);
        const filenames = getImageUploadKeys('products', files);
        const result = await uploadImages(filenames, files);
        if (!result.success || !result.urls) {
          throw new Error(result.error || 'Image upload failed.');
        }
        imageURLs = result.urls;
      }

      const saveResult = await putItem('products', { itemName: name, description, prices, customizations, imageURLs }, { createOnly: true });
      if (!saveResult.success) throw new Error(saveResult.error || 'Could not add product.');
      showCommitPending(saveResult);
      setRowStatus(form, 'Product added. Live site updates after the deploy finishes; reload the page to edit it.', 'success');
      form.reset();
    } catch (err) {
      console.error('Add product failed:', err);
      setRowStatus(form, err?.message || 'Could not add product.', 'danger');
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  // Add section.
  document.querySelectorAll('.add-section-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pageName = form.dataset.pageName;
      const sectionIndex = form.querySelector('[name="partitionKeyValue"]')?.value;
      const headerText = form.querySelector('[name="headerText"]')?.value || '';
      const bodyText = form.querySelector('[name="bodyText"]')?.value || '';
      if (!sectionIndex) return;

      const submitButton = form.querySelector('[type="submit"]');
      setRowStatus(form, 'Saving section...', 'info');
      setButtonBusy(submitButton, true, 'Adding...');

      try {
        // Keep Contact's first three sorted records reserved for its fixed intro/email/Instagram layout.
        if (pageName === 'contact_page' && (!Number.isInteger(Number(sectionIndex)) || Number(sectionIndex) < 3)) {
          throw new Error('Contact page section indexes must be whole numbers of 3 or greater.');
        }

        // Upload image if provided. Do not save a section with missing image URLs after an upload failure.
        let imageURLs = [];
        const imageInput = form.querySelector('[name="images[]"]');
        if (imageInput?.files?.length > 0) {
          const files = Array.from(imageInput.files);
          const filenames = getImageUploadKeys(pageName, files);
          const result = await uploadImages(filenames, files);
          if (!result.success || !result.urls) {
            throw new Error(result.error || 'Image upload failed.');
          }
          imageURLs = result.urls;
        }

        const saveResult = await putItem(pageName, { sectionIndex, headerText, bodyText, imageURLs }, { createOnly: true });
        if (!saveResult.success) throw new Error(saveResult.error || 'Could not add section.');
        showCommitPending(saveResult);
        setRowStatus(form, 'Section added. Live site updates after the deploy finishes; reload the page to edit it.', 'success');
        form.reset();
      } catch (err) {
        console.error('Add section failed:', err);
        setRowStatus(form, err?.message || 'Could not add section.', 'danger');
      } finally {
        setButtonBusy(submitButton, false);
      }
    });
  });
}
