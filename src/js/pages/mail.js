// mail.js - Admin mail page initialization

import { renderHeader } from '../components/header.js';
import { renderFooter } from '../components/footer.js';
import { isAuthenticated, setDesiredPage } from '../modules/auth.js';
import { getInbox, getOutbox } from '../aws/s3.js';
import { sendEmail } from '../aws/ses.js';

document.addEventListener('DOMContentLoaded', async () => {
  renderHeader();

  // Auth guard (mirrors Controller.php:208-215)
  if (!isAuthenticated()) {
    setDesiredPage('/mail');
    window.location.href = '/authenticate';
    return;
  }

  const container = document.getElementById('mail-content');
  if (!container) { renderFooter(); return; }

  // Fetch inbox/outbox from S3
  const inbox = await getInbox();
  const outbox = await getOutbox();

  // Sort by date, newest first (mirrors mail.php:24-27)
  inbox.sort((a, b) => (b.date || 0) - (a.date || 0));
  outbox.sort((a, b) => (b.date || 0) - (a.date || 0));

  const escapeHtml = (str) => {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  const formatBody = (value) => escapeHtml(value).replace(/\n/g, '<br>');

  // Render inbox (mirrors mail.php:29-37)
  let html = '<h2> Inbox: </h2>';
  if (inbox.length === 0) {
    html += '<p class="text-muted m-3">Inbox is empty.</p>';
  }
  inbox.forEach(mail => {
    html += `
      <div class="bg-light m-3">
        <div>from: ${escapeHtml(mail.from || '')}</div>
        <div>to: ${escapeHtml(mail.to || '')}</div>
        <div>date: ${escapeHtml(mail.date || '')}</div>
        <div>subject: ${escapeHtml(mail.subject || '')}</div>
        <div>body: ${formatBody(mail.body || '')}</div>
      </div>`;
  });

  // Render outbox (mirrors mail.php:45-55)
  html += '<h2> Sent: </h2>';
  if (outbox.length === 0) {
    html += '<p class="text-muted m-3">Outbox is empty.</p>';
  }
  outbox.forEach(mail => {
    html += `
      <div class="bg-light m-3">
        <div>from: ${escapeHtml(mail.from || '')}</div>
        <div>to: ${escapeHtml(mail.to || '')}</div>
        <div>date: ${escapeHtml(mail.date || '')}</div>
        <div>subject: ${escapeHtml(mail.subject || '')}</div>
        <div>body: ${formatBody(mail.body || '')}</div>
      </div>`;
  });

  // Compose form (mirrors mail.php:57-73)
  html += `
    <h2> Send a new email: </h2>
    <div class="row">
      <form id="compose-form" class="col-md-6 m-3 d-flex flex-column">
        <div class="mb-2"><strong>From:</strong> support@sweethopebakeryy.com</div>
        <input type="text" name="recipients" placeholder="Comma separated Recipient email addresses" required>
        <input type="text" name="subject" placeholder="Subject" required>
        <input type="text" name="body" id="body-input" placeholder="Body (HTML)" required>
        <button type="submit" class="btn btn-cookie button-2 mt-2">Send Email</button>
      </form>
      <div class="col-md-5">
        <div id="body-preview"></div>
      </div>
    </div>`;

  container.innerHTML = html;

  // ── Email body preview (from public/js/mail.js) ──
  const bodyInput = document.getElementById('body-input');
  const bodyPreview = document.getElementById('body-preview');
  if (bodyInput && bodyPreview) {
    bodyInput.addEventListener('input', () => {
      bodyPreview.innerHTML = bodyInput.value;
    });
  }

  // ── Send email handler ──
  document.getElementById('compose-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const email = {
      from: 'support@sweethopebakeryy.com',
      to: [form.querySelector('[name="recipients"]').value],
      subject: form.querySelector('[name="subject"]').value,
      body: form.querySelector('[name="body"]').value,
      date: Date.now()
    };
    await sendEmail(email);
  });

  renderFooter();
});
