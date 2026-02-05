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
 * Upload images via presigned URLs. Requires admin auth.
 * Flow: request presigned URLs from the server, then PUT directly to S3.
 * @param {string[]} filenames - S3 object keys (e.g., 'products/image.avif')
 * @param {File[]} files - File objects to upload
 * @returns {Promise<{success: boolean, urls?: string[], error?: string}>}
 */
async function uploadImages(filenames, files) {
  try {
    const response = await fetch('/api/upload-images', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ filenames })
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { uploads } = await response.json();

    // Upload each file directly to S3 using the presigned URL.
    const urls = [];
    for (let i = 0; i < uploads.length; i++) {
      const { presignedUrl, publicUrl } = uploads[i];
      await fetch(presignedUrl, {
        method: 'PUT',
        body: files[i],
        headers: { 'Content-Type': files[i].type }
      });
      urls.push(publicUrl);
    }

    return { success: true, urls };
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
    return [];
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
    return [];
  }
}

export { uploadImages, deleteImages, getInbox, getOutbox };
