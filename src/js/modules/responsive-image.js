import { escapeHtml } from './escape.js';

const RESPONSIVE_WIDTHS = [480, 960, 1600, 2400];

/**
 * Return escaped image attributes for an uploaded responsive AVIF family.
 * Existing and animated image URLs remain single-source images.
 */
export function responsiveImageAttributes(source, sizes = '100vw') {
  const src = String(source || '');
  const match = src.match(/^(.*)-w(\d+)(\.avif(?:[?#].*)?)$/i);
  if (!match) return `src="${escapeHtml(src)}"`;

  const [, prefix, rawWidth, suffix] = match;
  const maxWidth = Number(rawWidth);
  const widths = [...RESPONSIVE_WIDTHS.filter(width => width < maxWidth), maxWidth];
  const srcset = widths
    .map(width => `${prefix}-w${width}${suffix} ${width}w`)
    .join(', ');

  return `src="${escapeHtml(src)}" srcset="${escapeHtml(srcset)}" sizes="${escapeHtml(sizes)}"`;
}
