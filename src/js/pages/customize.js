// customize.js - admin customize page initialization.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared, ImageSlider } from '../shared.js';
import { isAuthenticated, setDesiredPage, getAuthToken } from '../modules/auth.js';
import { getTable, putItem, removeItem } from '../modules/database.js';
import { uploadImages, deleteImages } from '../aws/s3.js';
import { renderPageSectionEditor, renderLocalCodeAgentPanel } from '../components/customize-page.js';
import { escapeHtml } from '../modules/escape.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Auth guard: redirect to login if session is missing.
  if (!isAuthenticated()) {
    setDesiredPage('/customize');
    window.location.href = '/authenticate';
    return;
  }

  const container = document.getElementById('customize-content');
  if (!container) { renderFooter(); return; }

  // Fetch all editable data.
  const [products, homeSections, aboutSections, contactSections] = await Promise.all([
    getTable('products'),
    getTable('home_page'),
    getTable('about_page'),
    getTable('contact_page')
  ]);

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
    <h2 class="subtitle">Edit Menu</h2>
    <p class="text-muted small" id="deployment-version">Commit: loading…</p>
    <p>"Prices" will create a dropdown menu of those quantities at those prices. So "6:10, 12:15", would mean 6 for $10, or 12 for $15.</p>
    <p>"Customizations" currently dont do anything and you can just leave that field blank for now.</p>
    <p>I recommend uploading images that are of filetype .avif, as theyre most efficient size-wise and will make your site load faster. To convert a .png or .jpg to .avif you can use a site like: <a href="https://cloudinary.com/tools/jpg-to-avif" target="_blank">JPEG-To-Avif Converter</a></p>
    ${renderLocalCodeAgentPanel()}
    <div class="row menu-row">
      <div class="col-2"><h5>Product Name</h5></div>
      <div class="col-2"><h5>Description</h5></div>
      <div class="col-2"><h5>Prices</h5></div>
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
        <button type="button" class="btn btn-sm btn-danger remove-image-btn">&times;</button>
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
        <textarea class="form-control edit-itemName" rows="4">${safeItemName}</textarea>
        <input type="hidden" class="original-itemName" value="${safeItemName}">
      </div>
      <div class="col-2 edit-mode" style="display: none;">
        <textarea class="form-control edit-description" rows="4">${safeDescription}</textarea>
      </div>
      <div class="col-2 edit-mode" style="display: none;">
        <textarea class="form-control edit-prices" rows="4">${safePricesStr}</textarea>
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
          <input type="file" class="form-control mt-2 add-images-input" multiple accept="image/*">
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
  html += `
    <form class="row menu-row add-product-form">
      <div class="col-2"><textarea rows="4" name="partitionKeyValue" placeholder="Product Name" required></textarea></div>
      <div class="col-2"><textarea rows="4" name="description" placeholder="Product description"></textarea></div>
      <div class="col-2"><textarea rows="4" name="csvPrices" placeholder="qnty: price, qnty: price, ..." required></textarea></div>
      <div class="col-2"><textarea rows="4" name="csvCustomizations" placeholder="cstm: price, cstm: price, ..."></textarea></div>
      <div class="col-2"><input type="file" name="images[]" multiple accept="image/*" required></div>
      <div class="col-2 right-align">
        <input type="hidden" name="tableName" value="products">
        <input type="hidden" name="partitionKey" value="itemName">
        <button type="submit" class="btn btn-cookie button-2 mt-2">Add Item</button>
      </div>
    </form>
  </div>`;

  // Temporarily disabled at the user's request; restore this line to show the live site preview:
  // import { renderSitePreview } from '../components/customize-page.js';
  // ${renderSitePreview(products, homeSections, aboutSections, contactSections)}

  // Page section editors.
  html += renderPageSectionEditor(formatSections(homeSections), 'home_page');
  html += renderPageSectionEditor(formatSections(aboutSections), 'about_page');
  html += renderPageSectionEditor(formatSections(contactSections), 'contact_page');

  container.innerHTML = html;

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
      .catch(() => {
        deploymentVersion.textContent = 'Commit: unavailable';
      });
  }

  // ── Event handlers ──
  initProductEditHandlers();
  initSectionEditHandlers();
  initRemoveHandlers();
  initAddHandlers();
  initLocalCodeAgentHandlers();

  renderFooter();
  initShared();
});

function initLocalCodeAgentHandlers() {
  const form = document.getElementById('local-code-agent-form');
  if (!form) return;
  const connectionLabel = form.parentElement.querySelector('[data-agent-connection]');
  const indicator = form.parentElement.querySelector('.local-agent-indicator');
  const taskStatus = form.querySelector('[data-agent-task]');
  const submitButton = form.querySelector('[data-agent-submit]');
  const promptInput = form.querySelector('[name="prompt"]');
  const authToken = getAuthToken();
  let activePoll = null;
  let isOnline = false;

  const adminFetch = (url, options = {}) => fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${authToken}`,
      ...options.headers
    }
  });

  const setConnection = (online, busy = false) => {
    isOnline = online;
    connectionLabel.textContent = online
      ? busy ? 'Your Mac is working on a request.' : 'Your Mac is on and connected.'
      : 'Your Mac is off or disconnected. Start the local agent on your Mac to send a request.';
    indicator.classList.toggle('is-online', online);
    indicator.classList.toggle('is-offline', !online);
    promptInput.disabled = !online || busy || Boolean(activePoll);
    submitButton.disabled = !online || busy || Boolean(activePoll);
    if (!activePoll) submitButton.textContent = busy ? 'Mac is busy' : 'Send to Mac';
  };

  const refreshConnection = async () => {
    try {
      const response = await adminFetch('/api/codex/agent/status');
      if (!response.ok) throw new Error('Could not read agent status.');
      const { online, busy } = await response.json();
      setConnection(Boolean(online), Boolean(busy));
    } catch {
      setConnection(false);
    }
  };

  const renderTaskUpdate = (prompt, task) => {
    taskStatus.replaceChildren();
    const promptLabel = document.createElement('strong');
    promptLabel.textContent = 'Exact prompt sent to Luna';
    const promptEcho = document.createElement('pre');
    promptEcho.textContent = prompt;
    const title = document.createElement('strong');
    title.textContent = task.status === 'complete' ? 'Luna response' : task.status === 'failed' ? 'Request failed' : task.message || 'Your Mac is working…';
    taskStatus.append(promptLabel, promptEcho, title);
    if (task.summary) {
      const summary = document.createElement('pre');
      summary.textContent = task.summary;
      taskStatus.appendChild(summary);
    }
  };

  const pollTask = async (taskId, prompt) => {
    taskStatus.hidden = false;
    renderTaskUpdate(prompt, { status: 'running', message: 'Request sent directly to your Mac.' });
    activePoll = window.setInterval(async () => {
      try {
        const response = await adminFetch(`/api/codex/tasks/${encodeURIComponent(taskId)}`);
        if (!response.ok) throw new Error('Could not get the latest task status.');
        const task = await response.json();
        renderTaskUpdate(prompt, task);
        if (task.status === 'complete' || task.status === 'failed') {
          window.clearInterval(activePoll);
          activePoll = null;
          submitButton.textContent = 'Send another request';
          refreshConnection();
        } else {
          submitButton.disabled = !isOnline;
          promptInput.disabled = !isOnline;
        }
      } catch (error) {
        taskStatus.textContent = error.message;
      }
    }, 2500);
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const prompt = promptInput.value.trim();
    if (!prompt || submitButton.disabled || !isOnline) return;
    submitButton.disabled = true;
    promptInput.disabled = true;
    submitButton.textContent = 'Sending…';
    taskStatus.hidden = false;
    renderTaskUpdate(prompt, { status: 'running', message: 'Sending directly to your Mac…' });
    try {
      const response = await adminFetch('/api/codex/tasks', {
        method: 'POST',
        body: JSON.stringify({ prompt })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not send the request.');
      submitButton.textContent = 'Working…';
      pollTask(result.taskId, prompt);
    } catch (error) {
      renderTaskUpdate(prompt, { status: 'failed', message: error.message });
      await refreshConnection();
      promptInput.disabled = !isOnline;
      submitButton.disabled = !isOnline;
      submitButton.textContent = 'Try again';
    }
  });

  let connectionPoll = null;
  const startConnectionPolling = () => {
    if (document.hidden || connectionPoll) return;
    refreshConnection();
    connectionPoll = window.setInterval(refreshConnection, 15000);
  };
  const stopConnectionPolling = () => {
    if (!connectionPoll) return;
    window.clearInterval(connectionPoll);
    connectionPoll = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopConnectionPolling();
    else startConnectionPolling();
  });
  startConnectionPolling();
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
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      onRemove(url, item);
    });

    item.appendChild(img);
    item.appendChild(btn);
    container.appendChild(item);
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
      const prices = row.querySelector('.edit-prices')?.value;
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
        parsedPrices = parsePrices(prices);

        // Upload new images and collect their public URLs.
        let newImageURLs = [];
        const newImagesInput = row.querySelector('.add-images-input');
        if (newImagesInput?.files?.length > 0) {
          const files = Array.from(newImagesInput.files);
          const filenames = files.map(f => `products/${Date.now()}-${f.name}`);
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
          const filenames = files.map(f => `${pageName}/${Date.now()}-${f.name}`);
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

        // Update view mode image.
        const viewImg = row.querySelector('.view-mode img.demo-photo');
        if (viewImg && imageURLs[0]) viewImg.src = imageURLs[0];

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
      await removeItem(tableName, key);
    });
  });

  // Remove section.
  document.querySelectorAll('.remove-section-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tableName = form.querySelector('[name="tableName"]').value;
      const key = form.querySelector('[name="partitionKeyValue"]').value;
      await removeItem(tableName, key);
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
    const csvPrices = form.querySelector('[name="csvPrices"]')?.value || '';
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
      const prices = parsePrices(csvPrices);

      // Upload images before saving, so an upload failure cannot create a product
      // record with missing image URLs.
      let imageURLs = [];
      const imageInput = form.querySelector('[name="images[]"]');
      if (imageInput?.files?.length > 0) {
        const files = Array.from(imageInput.files);
        const filenames = files.map(f => `products/${Date.now()}-${f.name}`);
        const result = await uploadImages(filenames, files);
        if (!result.success || !result.urls) {
          throw new Error(result.error || 'Image upload failed.');
        }
        imageURLs = result.urls;
      }

      const saveResult = await putItem('products', { itemName: name, description, prices, customizations, imageURLs }, { createOnly: true });
      if (!saveResult.success) throw new Error(saveResult.error || 'Could not add product.');
      setRowStatus(form, 'Product added. Reload the page to edit it.', 'success');
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
          const filenames = files.map(f => `${pageName}/${Date.now()}-${f.name}`);
          const result = await uploadImages(filenames, files);
          if (!result.success || !result.urls) {
            throw new Error(result.error || 'Image upload failed.');
          }
          imageURLs = result.urls;
        }

        const saveResult = await putItem(pageName, { sectionIndex, headerText, bodyText, imageURLs }, { createOnly: true });
        if (!saveResult.success) throw new Error(saveResult.error || 'Could not add section.');
        setRowStatus(form, 'Section added. Reload the page to edit it.', 'success');
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
