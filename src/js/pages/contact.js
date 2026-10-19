// contact.js - Contact page initialization.

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { initShared } from '../shared.js';
import { getTable } from '../modules/database.js';
import { escapeHtml } from '../modules/escape.js';
import { showLoading, showError, showReady } from '../modules/page-state.js';

document.addEventListener('DOMContentLoaded', () => {
  renderHeader();
  renderFooter();
  initShared();
  const container = document.getElementById('contact-content');
  showLoading(container, 'Loading contact information…');
  loadContactSections();
});

async function loadContactSections() {
  const container = document.getElementById('contact-content');
  showLoading(container, 'Loading contact information…');
  try {
  // Fetch and sort contact page sections.
  const sections = await getTable('contact_page');
  sections.sort((a, b) => Number(a.sectionIndex) - Number(b.sectionIndex));

  // Render contact content.
  if (container && sections.length >= 3) {
    const safeHeader0 = escapeHtml(sections[0].headerText);
    const safeBody0 = escapeHtml(sections[0].bodyText);
    const safeHeader1 = escapeHtml(sections[1].headerText);
    const safeBody1 = escapeHtml(sections[1].bodyText);
    const safeHeader2 = escapeHtml(sections[2].headerText);
    const safeBody2 = escapeHtml(sections[2].bodyText);
    const extraSections = sections.slice(3).map(section => {
      const header = escapeHtml(section.headerText || '');
      const body = escapeHtml(section.bodyText || '');
      return `<section class="contact-extra-section">${header ? `<h3>${header}</h3>` : ''}${body ? `<p>${body}</p>` : ''}</section>`;
    }).join('');
    container.innerHTML = `
      <h2 class="subtitle">${safeHeader0}</h2>
      <h5 class="description">${safeBody0}</h5>
      <div class="contact-info">
        <p class="contact-info-email"><strong>${safeHeader1}:</strong> <a href="mailto:${safeBody1}" class="contact-page-link">${safeBody1}</a></p>
        <p class="contact-info-instagram"><strong>${safeHeader2}:</strong> <a href="https://www.instagram.com/sweethopebakeryy/" target="_blank" rel="noopener noreferrer" class="contact-page-link">${safeBody2} <i class="fa-brands fa-instagram"></i></a></p>
      </div>
      <section class="instagram-preview" aria-labelledby="instagram-preview-title">
        <h3 id="instagram-preview-title">A little look at our Instagram</h3>
        <a class="instagram-preview-card" href="https://www.instagram.com/sweethopebakeryy/" target="_blank" rel="noopener noreferrer" aria-label="Visit Sweet Hope Bakery on Instagram">
          <span class="instagram-preview-icon" aria-hidden="true"><i class="fa-brands fa-instagram"></i></span>
          <span class="instagram-preview-name">@sweethopebakeryy</span>
          <span class="instagram-preview-description">Custom cakes, cookies, donuts, and more baked treats.</span>
          <span class="instagram-preview-button">Visit Instagram <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span>
        </a>
      </section>${extraSections}`;
  }
  showReady(container);
  } catch {
    showError(container, 'We could not load contact information. Please try again.', loadContactSections);
  }
}
