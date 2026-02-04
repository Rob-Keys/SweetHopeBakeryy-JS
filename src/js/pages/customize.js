// customize.js - Admin customize page initialization
// Replaces private/frontend/pages/customize.php + public/js/customize.js

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { isAuthenticated, setDesiredPage } from '../modules/auth.js';
import { getTable, putItem, removeItem } from '../modules/database.js';
import { uploadImages, deleteImages } from '../aws/s3.js';
import { renderPageSectionEditor } from '../components/customize-page.js';
import { escapeHtml } from '../modules/escape.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Auth guard (mirrors Controller.php:180-191)
  if (!isAuthenticated()) {
    setDesiredPage('/customize');
    window.location.href = '/authenticate';
    return;
  }

  const container = document.getElementById('customize-content');
  if (!container) { renderFooter(); return; }

  // Fetch all data (mirrors Controller.php:182-185)
  const [products, homeSections, aboutSections, contactSections] = await Promise.all([
    getTable('products'),
    getTable('home_page'),
    getTable('about_page'),
    getTable('contact_page')
  ]);

  // Sort sections
  homeSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  aboutSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));
  contactSections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Format sections for the component (mirrors Controller.php:585-598 get_page_sections_from_database)
  const formatSections = (sections) => sections.map(s => ({
    sectionIndex: s.sectionIndex,
    headerText: s.headerText || '',
    bodyText: s.bodyText || '',
    imageURL: s.imageURLs ? s.imageURLs[0] : '',
    imageURLs: s.imageURLs || []
  }));

  // ── Render product editor (mirrors customize.php:26-155) ──
  let html = `<div class="m-5">
    <h2 class="subtitle">Edit Menu</h2>
    <p>"Prices" will create a dropdown menu of those quantities at those prices. So "6:10, 12:15", would mean 6 for $10, or 12 for $15.</p>
    <p>"Customizations" currently dont do anything and you can just leave that field blank for now.</p>
    <p>I recommend uploading images that are of filetype .avif, as theyre most efficient size-wise and will make your site load faster. To convert a .png or .jpg to .avif you can use a site like: <a href="https://cloudinary.com/tools/jpg-to-avif" target="_blank">JPEG-To-Avif Converter</a></p>
    <div class="row menu-row">
      <div class="col-2"><h5>Product Name</h5></div>
      <div class="col-2"><h5>Description</h5></div>
      <div class="col-2"><h5>Prices</h5></div>
      <div class="col-2"><h5>Customizations</h5></div>
      <div class="col-2"><h5>Image</h5></div>
      <div class="col-2 right-align"><h5>Actions</h5></div>
    </div>`;

  // Product rows
  products.forEach((product, i) => {
    const pricesStr = Object.entries(product.prices || {}).map(([q, p]) => `${q}:${p}`).join(', ');
    const customStr = Object.entries(product.customizations || {}).map(([c, p]) => `${c}:${p}`).join(', ');
    const imageURLs = product.imageURLs || [];
    const safeItemName = escapeHtml(product.itemName);
    const safeDescription = escapeHtml(product.description || '');
    const safePricesStr = escapeHtml(pricesStr);
    const safeCustomStr = escapeHtml(customStr);

    // Slides for view mode
    const slidesHTML = imageURLs.map(url =>
      `<div class="slide"><img src="${escapeHtml(url)}" alt="${safeItemName} picture" class="product-image" loading="lazy" decoding="async"></div>`
    ).join('');
    const arrowsHTML = imageURLs.length > 1
      ? `<button class="arrow left">&#8249;</button><button class="arrow right">&#8250;</button>`
      : '';

    // Edit mode images
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

  // Add new product form
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

  // Page section editors (mirrors customize.php:157-163)
  html += renderPageSectionEditor(formatSections(homeSections), 'home_page');
  html += renderPageSectionEditor(formatSections(aboutSections), 'about_page');
  html += renderPageSectionEditor(formatSections(contactSections), 'contact_page');

  container.innerHTML = html;

  // ── Event handlers (from public/js/customize.js) ──
  initProductEditHandlers();
  initSectionEditHandlers();
  initRemoveHandlers();
  initAddHandlers();

  renderFooter();
  initShared();
});

// ── Product edit/save handlers (mirrors customize.js:1-88) ──
function initProductEditHandlers() {
  const menuRows = document.querySelectorAll('.menu-row[data-item-index]');
  menuRows.forEach(row => {
    const editBtn = row.querySelector('.edit-item-btn');
    const saveBtn = row.querySelector('.save-edits-btn');
    const viewModeElements = row.querySelectorAll('.view-mode');
    const editModeElements = row.querySelectorAll('.edit-mode');
    let imagesToRemove = [];

    // Remove image buttons
    row.querySelectorAll('.remove-image-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const imageItem = btn.closest('.edit-image-item');
        imagesToRemove.push(imageItem.dataset.imageUrl);
        imageItem.remove();
      });
    });

    editBtn?.addEventListener('click', () => {
      imagesToRemove = [];
      viewModeElements.forEach(el => el.style.display = 'none');
      editModeElements.forEach(el => el.style.display = 'block');
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    });

    saveBtn?.addEventListener('click', async () => {
      const itemName = row.querySelector('.edit-itemName')?.value;
      const originalItemName = row.querySelector('.original-itemName')?.value;
      const description = row.querySelector('.edit-description')?.value;
      const prices = row.querySelector('.edit-prices')?.value;
      const customizations = row.querySelector('.edit-customizations')?.value;

      // Parse prices
      const parsedPrices = {};
      if (prices) {
        prices.split(',').forEach(pair => {
          const [q, p] = pair.split(':').map(s => s.trim());
          if (q && p) parsedPrices[q] = parseInt(p);
        });
      }

      // Parse customizations
      const parsedCustom = {};
      if (customizations) {
        customizations.split(',').forEach(pair => {
          const [c, p] = pair.split(':').map(s => s.trim());
          if (c && p) parsedCustom[c] = p;
        });
      }

      // Build current image URLs (start with existing, minus removed)
      const currentImageURLs = (product.imageURLs || []).filter(url => !imagesToRemove.includes(url));

      // Delete removed images from S3
      if (imagesToRemove.length > 0) {
        const s3Keys = imagesToRemove.map(url => {
          try { return new URL(url).pathname.replace(/^\//, ''); } catch { return url; }
        });
        await deleteImages(s3Keys);
      }

      // Upload new images and collect their public URLs
      let newImageURLs = [];
      const newImagesInput = row.querySelector('.add-images-input');
      if (newImagesInput?.files?.length > 0) {
        const files = Array.from(newImagesInput.files);
        const filenames = files.map(f => `products/${Date.now()}-${f.name}`);
        const result = await uploadImages(filenames, files);
        if (result.success && result.urls) {
          newImageURLs = result.urls;
        }
      }

      // Save item with combined image URLs
      await putItem('products', {
        itemName,
        description,
        prices: parsedPrices,
        customizations: parsedCustom,
        imageURLs: [...currentImageURLs, ...newImageURLs]
      });
    });
  });
}

// ── Section edit/save handlers (mirrors customize.js:90-179) ──
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
      viewModeElements.forEach(el => el.style.display = 'none');
      editModeElements.forEach(el => el.style.display = 'block');
      editBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
    });

    saveBtn?.addEventListener('click', async () => {
      const sectionIndex = row.querySelector('.edit-sectionIndex')?.value;
      const headerTextEl = row.querySelector('.edit-headerText');
      const headerText = headerTextEl ? headerTextEl.value : '';
      const bodyText = row.querySelector('.edit-bodyText')?.value;

      // Start with existing images, minus any removed
      const existingImages = row.dataset.imageUrls ? JSON.parse(row.dataset.imageUrls) : [];
      let currentImageURLs = imageToRemove
        ? existingImages.filter(url => url !== imageToRemove)
        : [...existingImages];

      // Delete removed image from S3
      if (imageToRemove) {
        try {
          const s3Key = new URL(imageToRemove).pathname.replace(/^\//, '');
          await deleteImages([s3Key]);
        } catch { /* local image path */ }
      }

      // Upload new images
      let newImageURLs = [];
      const newImageInput = row.querySelector('.add-images-input');
      if (newImageInput?.files?.length > 0) {
        const files = Array.from(newImageInput.files);
        const filenames = files.map(f => `${pageName}/${Date.now()}-${f.name}`);
        const result = await uploadImages(filenames, files);
        if (result.success && result.urls) {
          newImageURLs = result.urls;
        }
      }

      await putItem(pageName, {
        sectionIndex,
        headerText,
        bodyText,
        imageURLs: [...currentImageURLs, ...newImageURLs]
      });
    });
  });
}

// ── Remove handlers ──
function initRemoveHandlers() {
  // Product remove
  document.querySelectorAll('.remove-item-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tableName = form.querySelector('[name="tableName"]').value;
      const key = form.querySelector('[name="partitionKeyValue"]').value;
      await removeItem(tableName, key);
    });
  });

  // Section remove
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
  // Add product
  document.querySelector('.add-product-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.querySelector('[name="partitionKeyValue"]').value;
    const description = form.querySelector('[name="description"]')?.value || '';
    const csvPrices = form.querySelector('[name="csvPrices"]')?.value || '';
    const csvCustomizations = form.querySelector('[name="csvCustomizations"]')?.value || '';
    if (!name) return;

    // Parse prices
    const prices = {};
    csvPrices.split(',').forEach(pair => {
      const [q, p] = pair.split(':').map(s => s.trim());
      if (q && p) prices[q] = parseInt(p);
    });

    // Parse customizations
    const customizations = {};
    csvCustomizations.split(',').forEach(pair => {
      const [c, p] = pair.split(':').map(s => s.trim());
      if (c && p) customizations[c] = p;
    });

    // Upload images
    let imageURLs = [];
    const imageInput = form.querySelector('[name="images[]"]');
    if (imageInput?.files?.length > 0) {
      const files = Array.from(imageInput.files);
      const filenames = files.map(f => `products/${Date.now()}-${f.name}`);
      const result = await uploadImages(filenames, files);
      if (result.success && result.urls) {
        imageURLs = result.urls;
      }
    }

    await putItem('products', { itemName: name, description, prices, customizations, imageURLs });
  });

  // Add section
  document.querySelectorAll('.add-section-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pageName = form.dataset.pageName;
      const sectionIndex = form.querySelector('[name="partitionKeyValue"]')?.value;
      const headerText = form.querySelector('[name="headerText"]')?.value || '';
      const bodyText = form.querySelector('[name="bodyText"]')?.value || '';
      if (!sectionIndex) return;

      // Upload image if provided
      let imageURLs = [];
      const imageInput = form.querySelector('[name="images[]"]');
      if (imageInput?.files?.length > 0) {
        const files = Array.from(imageInput.files);
        const filenames = files.map(f => `${pageName}/${Date.now()}-${f.name}`);
        const result = await uploadImages(filenames, files);
        if (result.success && result.urls) {
          imageURLs = result.urls;
        }
      }

      await putItem(pageName, { sectionIndex, headerText, bodyText, imageURLs });
    });
  });
}
