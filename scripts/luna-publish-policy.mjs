const STYLE_PATH = /^src\/styles\/[A-Za-z0-9_-]+\.css$/i;
const IMAGE_PATH = /^src\/images\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:avif|gif|ico|jpe?g|png|webp)$/i;

export function isAutonomousPublishPath(path, mode = '100644') {
  return mode === '100644' && typeof path === 'string' && !path.includes('\\') &&
    (STYLE_PATH.test(path) || IMAGE_PATH.test(path));
}
