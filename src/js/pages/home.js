// home.js - Home page initialization
// Replaces the dynamic PHP loop in private/frontend/pages/home.php:45-58

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Fetch home page sections (mirrors Controller.php:87-88)
  const sections = await getTable('home_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render alternating image+text rows (mirrors home.php:46-57)
  const container = document.getElementById('home-sections');
  if (container) {
    let html = '';
    sections.forEach((section, index) => {
      const imageURL = section.imageURLs ? section.imageURLs[0] : '';
      const rowClass = index % 2 === 0 ? 'row mb-5' : 'row row-reverse mb-5';
      const imgFade = index % 2 === 0 ? 'fade-in-right' : 'fade-in-left';
      const txtFade = index % 2 === 0 ? 'fade-in-left' : 'fade-in-right';

      html += `
        <div class="${rowClass}">
          <div class="col-5 ${imgFade}">
            <img style="width: 100%;" src="${imageURL}">
          </div>
          <div class="col-6 d-flex align-items-center ${txtFade}">
            <div class="image-caption d-flex flex-column align-items-center">
              <h3>${section.bodyText}</h3>
              <a href="/menu" class="btn btn-lg btn-cookie mt-5">Order Now</a>
            </div>
          </div>
        </div>`;
    });
    container.innerHTML = html;
  }

  renderFooter();
  initShared();
});
