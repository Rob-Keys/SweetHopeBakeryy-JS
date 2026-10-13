const ALLOWED_PREFIXES = ['images/', 'header/', 'products/', 'home_page/', 'about_page/', 'contact_page/'];

export const MAX_S3_CHANGE_OPERATIONS = 20;
export const MAX_S3_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_S3_ASSET_TOTAL_BYTES = 100 * 1024 * 1024;

export const S3_MEDIA_TYPES = Object.freeze({
  avif: 'image/avif',
  webp: 'image/webp',
  webm: 'video/webm'
});

const DELETABLE_EXTENSIONS = new Set([
  'avif', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'ico', 'webm', 'svg', 'bmp', 'heic', 'tif', 'tiff',
  'mp4', 'm4v', 'mov', 'avi', 'mpg', 'mpeg'
]);

function isSafeS3Key(key) {
  if (typeof key !== 'string' || key.length === 0 || key.length > 220) return false;
  if (key.startsWith('/') || key.includes('..') || key.includes('\\') || /[\u0000-\u001f\u007f]/.test(key)) return false;
  if (key === 'sweethopebakeryy.ico') return true;
  return ALLOWED_PREFIXES.some(prefix => key.startsWith(prefix));
}

export function validateS3Changes(changeSet) {
  if (!changeSet || typeof changeSet !== 'object' || Array.isArray(changeSet) || changeSet.version !== 1 || !Array.isArray(changeSet.operations)) {
    throw new Error('S3 change artifact must use version 1 and contain an operations array.');
  }
  if (Object.keys(changeSet).some(name => !['version', 'operations'].includes(name))) throw new Error('S3 change artifact has unsupported fields.');
  if (changeSet.operations.length < 1 || changeSet.operations.length > MAX_S3_CHANGE_OPERATIONS) {
    throw new Error(`S3 change artifact must contain between 1 and ${MAX_S3_CHANGE_OPERATIONS} operations.`);
  }

  const seen = new Set();
  return changeSet.operations.map((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation) || !['put', 'delete'].includes(operation.action)) {
      throw new Error(`S3 operation ${index + 1} has an invalid action.`);
    }
    const expectedKeys = operation.action === 'put' ? ['action', 'key', 'file'] : ['action', 'key'];
    if (Object.keys(operation).some(name => !expectedKeys.includes(name)) || expectedKeys.some(name => !(name in operation))) {
      throw new Error(`S3 operation ${index + 1} has unsupported or missing fields.`);
    }
    if (!isSafeS3Key(operation.key)) throw new Error(`S3 operation ${index + 1} has an invalid key.`);

    const extension = operation.key.split('.').pop().toLowerCase();
    if (operation.action === 'put') {
      if (!S3_MEDIA_TYPES[extension]) throw new Error(`S3 operation ${index + 1} must use an AVIF, WebP, or WebM asset.`);
      if (typeof operation.file !== 'string' || !/^\.luna-s3-assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:avif|webp|webm)$/i.test(operation.file)) {
        throw new Error(`S3 operation ${index + 1} must reference a file inside .luna-s3-assets/.`);
      }
      if (operation.file.split('.').pop().toLowerCase() !== extension) throw new Error(`S3 operation ${index + 1} has mismatched file and key formats.`);
    } else if (!DELETABLE_EXTENSIONS.has(extension)) {
      throw new Error(`S3 operation ${index + 1} has an unsupported file type for deletion.`);
    }

    if (seen.has(operation.key)) throw new Error(`S3 change artifact repeats key ${operation.key}.`);
    seen.add(operation.key);
    return operation.action === 'put'
      ? { action: 'put', key: operation.key, file: operation.file }
      : { action: 'delete', key: operation.key };
  });
}
