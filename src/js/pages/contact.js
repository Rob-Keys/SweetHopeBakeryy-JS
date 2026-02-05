// contact.js - Contact page initialization.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';
import { escapeHtml } from '../modules/escape.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Fetch and sort contact page sections.
  const sections = await getTable('contact_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render contact content.
  const container = document.getElementById('contact-content');
  if (container && sections.length >= 3) {
    const safeHeader0 = escapeHtml(sections[0].headerText);
    const safeBody0 = escapeHtml(sections[0].bodyText);
    const safeHeader1 = escapeHtml(sections[1].headerText);
    const safeBody1 = escapeHtml(sections[1].bodyText);
    const safeHeader2 = escapeHtml(sections[2].headerText);
    const safeBody2 = escapeHtml(sections[2].bodyText);
    container.innerHTML = `
      <h2 class="subtitle">${safeHeader0}</h2>
      <h5 class="description">${safeBody0}</h5>
      <div class="contact-info">
        <p class="contact-info-email"><strong>${safeHeader1}:</strong> <a href="mailto:${safeBody1}" class="contact-page-link">${safeBody1}</a></p>
        <p class="contact-info-instagram"><strong>${safeHeader2}:</strong> <a href="https://www.instagram.com/sweethopebakeryy/" target="_blank" class="contact-page-link">${safeBody2} <i class="fa-brands fa-instagram"></i></a></p>
      </div>`;
  }

  renderFooter();
  initShared();
});
