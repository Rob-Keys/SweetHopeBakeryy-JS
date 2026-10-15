import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preparePreviewPage } from '../scripts/lib/preview-page.mjs';

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

test('visual preview waits for slow content and renders sections below the viewport', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div aria-busy="true">Loading…</div><div class="cv-auto" style="content-visibility:auto">Story</div>');
  await page.evaluate(() => setTimeout(() => {
    const element = document.querySelector('[aria-busy]');
    element.removeAttribute('aria-busy');
    element.textContent = 'Loaded content';
  }, 1000));
  await preparePreviewPage(page);
  assert.equal(await page.locator('div').first().textContent(), 'Loaded content');
  assert.equal(await page.locator('.cv-auto').evaluate(element => getComputedStyle(element).contentVisibility), 'visible');
});

test('visual preview fails when page data or required images are unavailable', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent('<div role="alert">Content unavailable <button data-retry>Retry</button></div>');
  await assert.rejects(preparePreviewPage(page), /could not load its content/);
  await page.setContent('<img src="data:image/png;base64,invalid" alt="Broken reference">');
  await assert.rejects(preparePreviewPage(page), /images could not load/);
});
