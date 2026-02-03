// mail.js - Admin mail page initialization
// Replaces private/frontend/pages/mail.php + public/js/mail.js
// Inbox/outbox and email sending are STUBBED until Lambda is implemented.

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

  // Fetch inbox/outbox (STUBBED - returns empty arrays)
  const inbox = await getInbox();
  const outbox = await getOutbox();

  // Sort by date, newest first (mirrors mail.php:24-27)
  inbox.sort((a, b) => (b.date || 0) - (a.date || 0));
  outbox.sort((a, b) => (b.date || 0) - (a.date || 0));

  // Render inbox (mirrors mail.php:29-37)
  let html = '<h2> Inbox: </h2>';
  if (inbox.length === 0) {
    html += '<p class="text-muted m-3">Inbox is empty. (Requires Lambda to fetch from S3)</p>';
  }
  inbox.forEach(mail => {
    html += `
      <div class="bg-light m-3">
        <div>from: ${mail.from || ''}</div>
        <div>to: ${mail.to || ''}</div>
        <div>date: ${mail.date || ''}</div>
        <div>subject: ${mail.subject || ''}</div>
        <div>body: ${mail.body || ''}</div>
      </div>`;
  });

  // Render outbox (mirrors mail.php:45-55)
  html += '<h2> Sent: </h2>';
  if (outbox.length === 0) {
    html += '<p class="text-muted m-3">Outbox is empty. (Requires Lambda to fetch from S3)</p>';
  }
  outbox.forEach(mail => {
    html += `
      <div class="bg-light m-3">
        <div>from: ${mail.from || ''}</div>
        <div>to: ${mail.to || ''}</div>
        <div>date: ${mail.date || ''}</div>
        <div>subject: ${mail.subject || ''}</div>
        <div>body: ${mail.body || ''}</div>
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

  // ── Send email handler (STUBBED) ──
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
