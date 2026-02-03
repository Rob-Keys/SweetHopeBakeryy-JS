// database.js - Client-side database module
// Replaces private/backend/db/Database.php
// Reads static JSON data files via fetch(). Write operations stubbed for future Lambda.

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
    const response = await fetch(`/data/${tableName}.json`);
    if (!response.ok) throw new Error(`Failed to load ${tableName}: ${response.status}`);
    dataCache[tableName] = await response.json();
  }

  const data = dataCache[tableName];

  if (partitionKeyValue !== null) {
    const partitionKey = tableName === 'products' ? 'itemName' : 'sectionIndex';
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
 * STUBBED: Write an item to a table.
 * TODO: Implement as Lambda API endpoint.
 * Lambda should: accept { tableName, item }, write to JSON file, return { success: true }
 */
async function putItem(tableName, item) {
  console.warn('database.putItem STUBBED - requires Lambda:', { tableName, item });
  alert('Save functionality requires Lambda (not yet implemented).');
  return { success: false, message: 'Write operations require server-side Lambda (not yet implemented)' };
}

/**
 * STUBBED: Remove an item from a table by its partition key value.
 * TODO: Implement as Lambda API endpoint.
 * Lambda should: accept { tableName, key }, remove from JSON file, return { success: true }
 */
async function removeItem(tableName, key) {
  console.warn('database.removeItem STUBBED - requires Lambda:', { tableName, key });
  alert('Delete functionality requires Lambda (not yet implemented).');
  return { success: false, message: 'Write operations require server-side Lambda (not yet implemented)' };
}

export { getTable, putItem, removeItem, clearCache };
