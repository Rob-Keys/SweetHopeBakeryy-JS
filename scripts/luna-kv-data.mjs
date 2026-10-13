import { createHash } from 'node:crypto';

export const KV_TABLE_NAMES = ['products', 'home_page', 'about_page', 'contact_page'];

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashJson(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function validateKvChanges(changeSet) {
  if (!changeSet || typeof changeSet !== 'object' || Array.isArray(changeSet) || changeSet.version !== 1 || !Array.isArray(changeSet.operations)) {
    throw new Error('KV change artifact must use version 1 and contain an operations array.');
  }
  if (Object.keys(changeSet).some(name => !['version', 'operations'].includes(name))) throw new Error('KV change artifact has unsupported fields.');
  if (changeSet.operations.length < 1 || changeSet.operations.length > 50) {
    throw new Error('KV change artifact must contain between 1 and 50 operations.');
  }
  const seen = new Set();
  return changeSet.operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !KV_TABLE_NAMES.includes(operation.tableName)) {
      throw new Error(`KV operation ${index + 1} has an invalid table.`);
    }
    let key;
    if (operation.action === 'upsert') {
      if (Object.keys(operation).some(name => !['tableName', 'action', 'item'].includes(name))) throw new Error(`KV operation ${index + 1} has unsupported fields.`);
      if (!operation.item || typeof operation.item !== 'object' || Array.isArray(operation.item)) throw new Error(`KV operation ${index + 1} needs an item object.`);
      key = operation.tableName === 'products' ? operation.item.itemName : operation.item.sectionIndex;
    } else if (operation.action === 'delete') {
      if (Object.keys(operation).some(name => !['tableName', 'action', 'key'].includes(name))) throw new Error(`KV operation ${index + 1} has unsupported fields.`);
      key = operation.key;
    } else {
      throw new Error(`KV operation ${index + 1} has an invalid action.`);
    }
    if (operation.tableName === 'products') {
      if (typeof key !== 'string' || !key.trim()) throw new Error(`KV operation ${index + 1} needs a product name.`);
      key = key.trim();
      if (operation.action === 'upsert' && operation.item.itemName !== key) throw new Error(`KV operation ${index + 1} has an inconsistent product name.`);
      if (operation.action === 'upsert') {
        const prices = operation.item.prices;
        if (!prices || typeof prices !== 'object' || Array.isArray(prices) || Object.keys(prices).length === 0) {
          throw new Error(`KV operation ${index + 1} needs at least one price option.`);
        }
        for (const [quantity, price] of Object.entries(prices)) {
          if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) < 1) {
            throw new Error(`KV operation ${index + 1} has an invalid price quantity.`);
          }
          if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
            throw new Error(`KV operation ${index + 1} has an invalid price amount.`);
          }
        }
      }
    } else {
      const numericKey = Number(key);
      if (!Number.isSafeInteger(numericKey) || numericKey < 0) throw new Error(`KV operation ${index + 1} needs a whole section index.`);
      if (operation.tableName === 'contact_page' && operation.action === 'delete' && numericKey < 3) {
        throw new Error('The first three contact sections are required and cannot be removed.');
      }
      key = String(numericKey);
      if (operation.action === 'upsert' && Number(operation.item.sectionIndex) !== numericKey) throw new Error(`KV operation ${index + 1} has an inconsistent section index.`);
    }
    const identity = `${operation.tableName}\0${key}`;
    if (seen.has(identity)) throw new Error(`KV change artifact repeats ${operation.tableName} item ${key}.`);
    seen.add(identity);
    if (operation.action === 'upsert' && operation.tableName !== 'products') {
      return { ...operation, item: { ...operation.item, sectionIndex: key }, key };
    }
    return { ...operation, key };
  });
}
