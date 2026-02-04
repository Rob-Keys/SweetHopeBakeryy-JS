// about.js - About page initialization
// Replaces the dynamic PHP loop in private/frontend/pages/about.php:31-42

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';
import { escapeHtml } from '../modules/escape.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Fetch about page sections (mirrors Controller.php:91-92)
  const sections = await getTable('about_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render alternating image+text rows (mirrors about.php:31-41)
  const container = document.getElementById('about-sections');
  if (container) {
    let html = '';
    sections.forEach((section, index) => {
      const imageURL = section.imageURLs ? section.imageURLs[0] : '';
      const safeImageUrl = escapeHtml(imageURL);
      const safeHeaderText = escapeHtml(section.headerText || '');
      const safeBodyText = escapeHtml(section.bodyText || '');
      const rowClass = index % 2 === 0 ? 'row row-reverse mb-4' : 'row mb-4';
      const imgFade = index % 2 === 0 ? 'fade-in-left' : 'fade-in-right';
      const txtFade = index % 2 === 0 ? 'fade-in-right' : 'fade-in-left';

      html += `
        <div class="${rowClass} cv-auto">
          <div class="col-6 ${imgFade}">
            <img src="${safeImageUrl}" class="caroline-image" loading="lazy" decoding="async">
          </div>
          <div class="col-6 d-flex flex-column justify-content-center ${txtFade}">
            <h2 class="mb-3">${safeHeaderText}</h2>
            <h5>${safeBodyText}</h5>
          </div>
          <hr class="mobile-divider mt-3">
        </div>`;
    });
    container.innerHTML = html;
  }

  renderFooter();
  initShared();
});
