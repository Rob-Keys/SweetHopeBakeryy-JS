// s3.js - client helpers for S3-related admin endpoints.

import { getAuthToken, handle401 } from '../modules/auth.js';

/**
 * Build headers with auth token for admin API calls.
 * @returns {Object} headers object
 */
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Upload images through the authenticated server endpoint. Requires admin auth.
 * @param {string[]} filenames - S3 object keys (e.g., 'products/image.avif')
 * @param {File[]} files - File objects to upload
 * @returns {Promise<{success: boolean, urls?: string[], error?: string}>}
 */
async function uploadImages(filenames, files) {
  try {
    const formData = new FormData();
    formData.append('filenames', JSON.stringify(filenames));
    files.forEach((file, index) => formData.append(`file-${index}`, file));
    const headers = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/api/upload-images', {
      method: 'POST',
      headers,
      body: formData
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body?.error) message = body.error;
      } catch {
        // Keep the HTTP status when the response has no JSON error message.
      }
      throw new Error(message);
    }
    const { uploads } = await response.json();

    return { success: true, urls: uploads.map(upload => upload.publicUrl) };
  } catch (err) {
    console.error('uploadImages failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Delete images from S3. Requires admin auth.
 * @param {string[]} s3Keys - S3 object keys to delete
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteImages(s3Keys) {
  try {
    const response = await fetch('/api/delete-images', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ s3Keys })
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (err) {
    console.error('deleteImages failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Get email inbox from S3. Requires admin auth.
 * @returns {Promise<Array>} Array of email objects
 */
async function getInbox() {
  try {
    const headers = {};
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch('/api/get-inbox', { headers });
    if (response.status === 401) { handle401(); return []; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { emails } = await response.json();
    return emails;
  } catch (err) {
    console.error('getInbox failed:', err);
    throw err;
  }
}

/**
 * Get email outbox from S3. Requires admin auth.
 * @returns {Promise<Array>} Array of email objects
 */
async function getOutbox() {
  try {
    const headers = {};
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch('/api/get-outbox', { headers });
    if (response.status === 401) { handle401(); return []; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { emails } = await response.json();
    return emails;
  } catch (err) {
    console.error('getOutbox failed:', err);
    throw err;
  }
}

export { uploadImages, deleteImages, getInbox, getOutbox };
