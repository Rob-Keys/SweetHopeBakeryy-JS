// contact.js - Contact page initialization
// Replaces private/frontend/pages/contact.php dynamic content

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Fetch contact page sections (mirrors Controller.php:96-97)
  const sections = await getTable('contact_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render contact content (mirrors contact.php:31-36)
  const container = document.getElementById('contact-content');
  if (container && sections.length >= 3) {
    container.innerHTML = `
      <h2 class="subtitle">${sections[0].headerText}</h2>
      <h5 class="description">${sections[0].bodyText}</h5>
      <div class="contact-info">
        <p class="contact-info-email"><strong>${sections[1].headerText}:</strong> <a href="mailto:${sections[1].bodyText}" class="contact-page-link">${sections[1].bodyText}</a></p>
        <p class="contact-info-instagram"><strong>${sections[2].headerText}:</strong> <a href="https://www.instagram.com/sweethopebakeryy/" target="_blank" class="contact-page-link">${sections[2].bodyText} <i class="fa-brands fa-instagram"></i></a></p>
      </div>`;
  }

  renderFooter();
  initShared();
});
