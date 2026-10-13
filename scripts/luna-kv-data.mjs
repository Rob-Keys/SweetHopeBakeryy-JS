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
    } else {
      const numericKey = Number(key);
      if (!Number.isInteger(numericKey) || numericKey < 0) throw new Error(`KV operation ${index + 1} needs a whole section index.`);
      if (operation.tableName === 'contact_page' && numericKey < 3) throw new Error('Contact page section indexes must be 3 or greater.');
      key = String(numericKey);
      if (operation.action === 'upsert' && Number(operation.item.sectionIndex) !== numericKey) throw new Error(`KV operation ${index + 1} has an inconsistent section index.`);
    }
    const identity = `${operation.tableName}\0${key}`;
    if (seen.has(identity)) throw new Error(`KV change artifact repeats ${operation.tableName} item ${key}.`);
    seen.add(identity);
    return { ...operation, key };
  });
}
