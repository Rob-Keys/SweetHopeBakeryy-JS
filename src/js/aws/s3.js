// s3.js - client helpers for S3-related admin endpoints.

import { getAuthToken, handle401 } from '../modules/auth.js';
import { readApiError } from '../modules/api-error.js';

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
 * @param {string} directory - S3 directory for converted files
 * @param {File[]} files - File objects to upload
 * @returns {Promise<{success: boolean, urls?: string[], error?: string}>}
 */
async function uploadImages(directory, files) {
  try {
    const { convertImageVariantsForUpload } = await import('../modules/image-conversion.js');
    const fileGroups = [];
    for (const file of files) {
      const group = await convertImageVariantsForUpload(file);
      const imageId = crypto.randomUUID();
      const names = group.map(converted => {
        const width = converted.name.match(/-w(\d+)\.avif$/i)?.[1];
        const suffix = width ? `-w${width}` : '';
        const extension = converted.type === 'image/webp' ? 'webp' : 'avif';
        return `${directory}/${imageId}${suffix}.${extension}`;
      });
      fileGroups.push({ files: group, names });
    }
    const urls = [];
    const token = getAuthToken();
    for (let start = 0; start < fileGroups.length; start += 5) {
      const batch = fileGroups.slice(start, start + 5);
      const convertedFiles = batch.flatMap(group => group.files);
      const filenames = batch.flatMap(group => group.names);
      const formData = new FormData();
      formData.append('filenames', JSON.stringify(filenames));
      convertedFiles.forEach((file, index) => formData.append(`file-${index}`, file));
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const response = await fetch('/api/upload-images', {
        method: 'POST',
        headers,
        body: formData
      });
      if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
      if (!response.ok) throw new Error(await readApiError(response));
      const { uploads } = await response.json();
      let offset = 0;
      for (const group of batch) {
        urls.push(uploads[offset + group.files.length - 1].publicUrl);
        offset += group.files.length;
      }
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
    if (!response.ok) throw new Error(await readApiError(response));
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
    if (!response.ok) throw new Error(await readApiError(response));
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
    if (!response.ok) throw new Error(await readApiError(response));
    const { emails } = await response.json();
    return emails;
  } catch (err) {
    console.error('getOutbox failed:', err);
    throw err;
  }
}

export { uploadImages, deleteImages, getInbox, getOutbox };
