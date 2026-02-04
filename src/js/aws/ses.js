// ses.js - Email sending via Cloudflare Pages Function at /api/send-email
// Auth-protected — admin compose only

import { getAuthToken, handle401 } from '../modules/auth.js';

/**
 * Send an email via SES (server-side). Requires admin auth. Also archives to S3 outbox.
 * @param {Object} mail - { from, to: string[], subject, body, date }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendEmail(mail) {
  try {
    const headers = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers,
      body: JSON.stringify(mail)
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('sendEmail failed:', err);
    return { success: false, error: err.message };
  }
}

export { sendEmail };
