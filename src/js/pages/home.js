// home.js - Home page initialization.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';
import { escapeHtml } from '../modules/escape.js';
import { responsiveImageAttributes } from '../modules/responsive-image.js';
import { showLoading, showError, showReady } from '../modules/page-state.js';

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  initShared();
  const container = document.getElementById('home-sections');
  showLoading(container, 'Loading bakery stories…');
  loadHomeSections();
});

async function loadHomeSections() {
  const container = document.getElementById('home-sections');
  showLoading(container, 'Loading bakery stories…');
  try {
  // Fetch and sort home page sections.
  const sections = await getTable('home_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render alternating image/text rows.
  if (container) {
    let html = '';
    sections.forEach((section, index) => {
      const imageURL = section.imageURLs ? section.imageURLs[0] : '';
      const safeBodyText = escapeHtml(section.bodyText || '');
      const rowClass = index % 2 === 0 ? 'row mb-5' : 'row row-reverse mb-5';
      const imgFade = index % 2 === 0 ? 'fade-in-right' : 'fade-in-left';
      const txtFade = index % 2 === 0 ? 'fade-in-left' : 'fade-in-right';

      const sectionClass = index === 0 ? 'home-first-section' : '';

      html += `
        <div class="${rowClass} cv-auto ${sectionClass}">
          <div class="col-5 ${imgFade}">
            <img class="home-story-image" ${responsiveImageAttributes(imageURL, '(max-width: 767px) 90vw, 50vw')} alt="" loading="lazy" decoding="async">
          </div>
          <div class="col-6 d-flex align-items-center ${txtFade}">
            <div class="image-caption d-flex flex-column align-items-center">
              <h3>${safeBodyText}</h3>
              <a href="/menu" class="btn btn-lg btn-cookie mt-5">Order Now</a>
            </div>
          </div>
        </div>`;
    });
    container.innerHTML = html;
  }
  showReady(container);
  initShared();
  } catch {
    showError(container, 'We could not load these stories. Please try again.', loadHomeSections);
  }
}
