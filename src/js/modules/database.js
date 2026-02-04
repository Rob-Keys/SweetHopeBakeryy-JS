// database.js - Client-side database module
// Reads static JSON data files via fetch(). Writes go to Cloudflare Pages Functions at /api/*

import { getAuthToken, handle401, isAuthenticated } from './auth.js';

const dataCache = {};

/**
 * Get a table (or a single item from a table) by name.
 * @param {string} tableName - 'products', 'home_page', 'about_page', or 'contact_page'
 * @param {string|number|null} partitionKeyValue - Optional. If provided, returns a single matching item.
 *   For 'products', matches on 'itemName'. For page tables, matches on 'sectionIndex'.
 * @returns {Promise<Array|Object|null>}
 */
async function getTable(tableName, partitionKeyValue = null) {
  if (!dataCache[tableName]) {
    const useAdminApi = isAuthenticated();
    const url = useAdminApi
      ? `/api/get-data?tableName=${encodeURIComponent(tableName)}`
      : `/data/${tableName}.json`;

    const response = await fetch(url, useAdminApi ? { headers: authHeaders() } : undefined);
    if (response.status === 401 && useAdminApi) { handle401(); return null; }
    if (!response.ok) throw new Error(`Failed to load ${tableName}: ${response.status}`);
    dataCache[tableName] = await response.json();
  }

  const data = dataCache[tableName];

  if (partitionKeyValue !== null) {
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    if (!Array.isArray(data)) return data || null;
    return data.find(item => String(item[partitionKey]) === String(partitionKeyValue)) || null;
  }

  return data;
}

/**
 * Clear the in-memory cache for a table (or all tables).
 * @param {string|null} tableName
 */
function clearCache(tableName = null) {
  if (tableName) {
    delete dataCache[tableName];
  } else {
    Object.keys(dataCache).forEach(k => delete dataCache[k]);
  }
}

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
 * Write an item to a table via Pages Function. Requires admin auth.
 * @param {string} tableName
 * @param {Object} item
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function putItem(tableName, item) {
  try {
    const response = await fetch('/api/save-data', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tableName, item })
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    clearCache(tableName);
    return await response.json();
  } catch (err) {
    console.error('putItem failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Remove an item from a table by its partition key value via Pages Function. Requires admin auth.
 * @param {string} tableName
 * @param {string} key - partition key value
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function removeItem(tableName, key) {
  try {
    const response = await fetch('/api/delete-data', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tableName, key })
    });
    if (response.status === 401) { handle401(); return { success: false, error: 'Unauthorized' }; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    clearCache(tableName);
    return await response.json();
  } catch (err) {
    console.error('removeItem failed:', err);
    return { success: false, error: err.message };
  }
}

export { getTable, putItem, removeItem, clearCache };
