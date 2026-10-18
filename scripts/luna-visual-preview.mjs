#!/usr/bin/env node

import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { preparePreviewPage } from './lib/preview-page.mjs';

const repoRoot = resolve(import.meta.dirname, '..');
const siteRoot = resolve(repoRoot, 'dist');
const outputRoot = resolve(process.env.LUNA_PREVIEW_OUTPUT_DIR || resolve(process.env.RUNNER_TEMP || tmpdir(), 'luna-preview'));
const routes = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const renderAll = process.argv.includes('--all');
const pages = renderAll ? ['/', '/menu', '/about', '/contact'] : [routes[0] || '/'];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 }
];
const mimeTypes = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.xml': 'application/xml; charset=utf-8'
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
  if (requestUrl.pathname.startsWith('/api/')) {
    // Previews never contact live APIs.
    response.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'API writes are disabled in the visual preview.' }));
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (relativePath === '/') relativePath = '/index.html';
  else if (!extname(relativePath)) relativePath += '.html';

  const filePath = resolve(siteRoot, `.${relativePath}`);
  if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${sep}`)) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

await mkdir(outputRoot, { recursive: true });
await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const route of pages) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      if (!route.startsWith('/') || route.startsWith('//')) throw new Error(`Use a site path starting with one slash: ${route}`);
      const response = await page.goto(new URL(route, origin).toString(), { waitUntil: 'domcontentloaded' });
      if (!response?.ok()) throw new Error(`Could not load ${route} (${response?.status() || 'no response'}).`);
      await preparePreviewPage(page);

      const routeName = route === '/' ? 'home' : route.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-') || 'home';
      const imagePath = resolve(outputRoot, `${routeName}-${viewport.name}.png`);
      await page.screenshot({ path: imagePath, fullPage: true, animations: 'disabled' });
      console.log(`Screenshot: ${imagePath}`);
      if (errors.length) throw new Error(`Page errors on ${route} (${viewport.name}): ${errors.join(' | ')}`);
      await page.close();
    }
  }
} finally {
  await browser?.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

