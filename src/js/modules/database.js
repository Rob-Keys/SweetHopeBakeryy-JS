// Repository content bundled into each browser page at build time.

import { getAuthToken, handle401 } from './auth.js';
import products from '../../data/products.json';
import homePage from '../../data/home_page.json';
import aboutPage from '../../data/about_page.json';
import contactPage from '../../data/contact_page.json';

const TABLES = Object.freeze({
  products,
  home_page: homePage,
  about_page: aboutPage,
  contact_page: contactPage
});

/**
 * Get a table (or a single item from a table) by name.
 * @param {string} tableName - 'products', 'home_page', 'about_page', or 'contact_page'
 * @param {string|number|null} partitionKeyValue - Optional. If provided, returns a single matching item.
 *   For 'products', matches on 'itemName'. For page tables, matches on 'sectionIndex'.
 * @returns {Promise<Array|Object|null>}
 */
async function getTable(tableName, partitionKeyValue = null) {
  const source = TABLES[tableName];
  if (!source) throw new Error(`Unknown content table: ${tableName}`);
  const data = structuredClone(source);

  if (partitionKeyValue !== null) {
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
    if (!Array.isArray(data)) return data || null;
    return data.find(item => String(item[partitionKey]) === String(partitionKeyValue)) || null;
  }

  return data;
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
async function putItem(tableName, item, { createOnly = false, previousKey = null } = {}) {
  try {
    const response = await fetch('/api/save-data', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ tableName, item, createOnly, previousKey })
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
    return await response.json();
  } catch (err) {
    console.error('removeItem failed:', err);
    return { success: false, error: err.message };
  }
}

export { getTable, putItem, removeItem };
