// customize-page.js - Render page section editor
// Replaces private/frontend/components/customize_page.php

/**
 * Render the page section editor for a given page.
 * Matches customize_page.php structure exactly.
 * @param {Array} sections - Array of { sectionIndex, headerText, bodyText, imageURL }
 * @param {string} pageName - 'home_page', 'about_page', or 'contact_page'
 * @returns {string} HTML string
 */
export function renderPageSectionEditor(sections, pageName) {
  const displayName = pageName.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  const showHeader = pageName !== 'home_page';
  const showImage = pageName !== 'contact_page';
  const bodyColClass = pageName === 'about_page' ? 'col-4' : 'col-6';
  const editBodyColClass = pageName === 'home_page' ? 'col-4' : 'col-6';

  // Table header row
  let html = `
    <div class="m-5">
      <h2 class="subtitle">Edit ${displayName} Content</h2>
      <div class="row menu-row">
        <div class="col-2"><h5>Section Index</h5></div>`;

  if (showHeader) {
    html += `<div class="col-2"><h5>Header Text</h5></div>`;
  }
  html += `<div class="${bodyColClass}"><h5>Body Text</h5></div>`;
  if (showImage) {
    html += `<div class="col-2"><h5>Image URL</h5></div>`;
  }
  html += `<div class="col-2 right-align"><h5>Actions</h5></div>
      </div>`;

  // Section rows
  sections.forEach((section, i) => {
    html += `
      <div class="row menu-row" data-section-index="${i}" data-page-name="${pageName}">
        <!-- View Mode -->
        <div class="col-2 view-mode"><p>${section.sectionIndex}</p></div>`;

    if (showHeader) {
      html += `<div class="col-2 view-mode"><p>${section.headerText || ''}</p></div>`;
    }
    html += `<div class="${bodyColClass} view-mode"><p>${section.bodyText || ''}</p></div>`;

    // Edit Mode
    html += `
        <div class="col-2 edit-mode" style="display: none;">
          <textarea class="form-control edit-sectionIndex" rows="2" disabled>${section.sectionIndex}</textarea>
          <input type="hidden" class="original-sectionIndex" value="${section.sectionIndex}">
        </div>`;

    if (showHeader) {
      html += `
        <div class="col-2 edit-mode" style="display: none;">
          <textarea class="form-control edit-headerText" rows="2">${section.headerText || ''}</textarea>
        </div>`;
    }
    html += `
        <div class="${editBodyColClass} edit-mode" style="display: none;">
          <textarea class="form-control edit-bodyText" rows="4">${section.bodyText || ''}</textarea>
        </div>`;

    if (showImage) {
      const imageURL = section.imageURL || (section.imageURLs ? section.imageURLs[0] : '');
      html += `
        <div class="col-2">
          <div class="view-mode">
            <img class="demo-photo" src="${imageURL}" alt="Section's associated image">
          </div>
          <div class="edit-mode" style="display: none;">
            <div class="edit-images-container">
              <div class="edit-image-item" data-image-url="${imageURL}">
                <img src="${imageURL}" alt="Section image" class="edit-product-image" style="width: 80px; height: 80px; object-fit: cover;">
                <button type="button" class="btn btn-sm btn-danger remove-image-btn">&times;</button>
              </div>
            </div>
            <input type="file" class="form-control mt-2 add-images-input" accept="image/*">
            <small class="text-muted">Replace image</small>
          </div>
        </div>`;
    }

    html += `
        <div class="col-2 right-align">
          <button type="button" class="btn btn-cookie button-2 mt-2 edit-section-btn">Edit Section</button>
          <button type="button" class="btn btn-success button-2 mt-2 save-section-btn" style="display: none;">Save Edits</button>
          <form class="remove-section-form">
            <input type="hidden" name="tableName" value="${pageName}">
            <input type="hidden" name="partitionKey" value="sectionIndex">
            <input type="hidden" name="partitionKeyValue" value="${section.sectionIndex}">
            <button type="submit" class="btn btn-danger button-2 mt-2">Remove Section</button>
          </form>
        </div>
      </div>`;
  });

  // Add new section form
  html += `
    <form class="row menu-row add-section-form" data-page-name="${pageName}">
      <div class="col-2">
        <input type="text" name="partitionKeyValue" placeholder="Section Index">
      </div>`;

  if (showHeader) {
    html += `
      <div class="col-2">
        <textarea rows="2" name="headerText" placeholder="Header text"></textarea>
      </div>`;
  }
  html += `
      <div class="${bodyColClass}">
        <textarea rows="4" name="bodyText" placeholder="Body text"></textarea>
      </div>`;

  if (showImage) {
    html += `
      <div class="col-2">
        <input type="file" name="images[]">
      </div>`;
  }

  html += `
      <div class="col-2 right-align">
        <input type="hidden" name="tableName" value="${pageName}">
        <input type="hidden" name="partitionKey" value="sectionIndex">
        <button type="submit" class="btn btn-cookie button-2 mt-2">Add Section</button>
      </div>
    </form>
  </div>`;

  return html;
}
