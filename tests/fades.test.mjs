import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const origin = 'http://fade.test';
const siteRoot = new URL('../src/', import.meta.url);
const fixture = `<!doctype html>
  <link rel="stylesheet" href="/styles/shared.css">
  <style>
    html, body { height: auto; overflow: visible; }
    body { display: block; }
    .spacer { height: 1500px; }
    .sample { height: 120px; }
  </style>
  <div id="first" class="sample fade-in-up">First</div>
  <div id="essential" class="fade-in-left"><button>Always usable</button></div>
  <div class="spacer"></div>
  <div id="later" class="sample fade-in-right">Later</div>
  <div id="tall" class="fade-in-left" style="height: 30000px">Tall</div>
  <script type="module">
    import { initFadeEffects } from '/js/shared.js';
    window.initFadeEffects = initFadeEffects;
    initFadeEffects();
  </script>`;

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function openPage(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, ...options });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 204 });
    if (url.pathname === '/fixture') {
      return route.fulfill({ contentType: 'text/html', body: fixture });
    }
    if (url.pathname.startsWith('/api/')) {
      const data = url.pathname === '/api/get-data'
        ? [{ itemName: 'Cookies', prices: { 6: 12 }, imageURLs: [] }]
        : { debugErrors: false };
      return route.fulfill({ json: data });
    }
    const path = url.pathname === '/menu' ? 'menu.html' : url.pathname.slice(1);
    const contentType = path.endsWith('.js') ? 'text/javascript'
      : path.endsWith('.css') ? 'text/css' : 'text/html';
    try {
      return await route.fulfill({ contentType, body: await readFile(new URL(path, siteRoot)) });
    } catch {
      return route.fulfill({ status: 404 });
    }
  });
  return page;
}

async function openFixture(page) {
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => typeof window.initFadeEffects === 'function');
}

test('scroll reveals run once, including dynamic and very tall content', async (t) => {
  const page = await openPage(t);
  await page.addInitScript(() => {
    window.entrances = [];
    document.addEventListener('animationstart', (event) => {
      window.entrances.push(event.target.id);
    });
  });
  await openFixture(page);
  await page.waitForFunction(() => window.entrances.includes('first'));
  assert.equal(await page.locator('#essential').evaluate((el) => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#later').evaluate((el) => getComputedStyle(el).opacity), '1');
  await page.evaluate(() => {
    for (let index = 0; index < 10; index += 1) window.initFadeEffects();
  });
  await page.locator('#later').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.entrances.includes('later'));
  await page.evaluate(() => window.scrollTo(0, document.getElementById('tall').offsetTop));
  await page.waitForFunction(() => window.entrances.includes('tall'));
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="dynamic" class="sample fade-in-left">New content</div>');
    window.scrollTo(0, 0);
    window.initFadeEffects();
    window.initFadeEffects();
  });
  await page.waitForFunction(() => window.entrances.includes('dynamic'));
  await page.waitForFunction(() => document.getAnimations().length === 0);
  assert.deepEqual(await page.evaluate(() => [...window.entrances].sort()), ['dynamic', 'first', 'later', 'tall']);
});

test('missing observers and disabled JavaScript leave content visible', async (t) => {
  const page = await openPage(t);
  await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await openFixture(page);
  for (const selector of ['#first', '#later', '#tall']) {
    assert.equal(await page.locator(selector).evaluate((el) => getComputedStyle(el).opacity), '1');
  }
  const noJS = await openPage(t, { javaScriptEnabled: false });
  await noJS.goto(`${origin}/fixture`);
  assert.equal(await noJS.locator('#first').evaluate((el) => getComputedStyle(el).opacity), '1');
});

test('reduced motion suppresses entrances and cancels them without replay', async (t) => {
  const page = await openPage(t, { reducedMotion: 'reduce' });
  await openFixture(page);
  await page.locator('#later').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#first').evaluate((el) => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#later').evaluate((el) => getComputedStyle(el).animationName), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('afterbegin', '<div id="dynamic" class="sample fade-in-up">New</div>');
    window.scrollTo(0, 0);
    window.initFadeEffects();
  });
  await page.waitForFunction(() => document.getElementById('dynamic').getAnimations().length > 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.getElementById('dynamic').classList.contains('fade-visible'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.locator('#dynamic').evaluate((el) => getComputedStyle(el).opacity), '1');
  assert.equal(await page.locator('#dynamic').evaluate((el) => el.getAnimations().length), 0);
});

for (const reducedMotion of [false, true]) {
  test(`cart confirmations are removed with ${reducedMotion ? 'reduced' : 'normal'} motion`, async (t) => {
    const page = await openPage(t, { reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await page.goto(`${origin}/menu`);
    await page.locator('.add-to-cart-form button[type="submit"]').click();
    await page.locator('.add-to-cart-form button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.fade-in-out').length === 2);
    assert.equal(await page.locator('.fade-in-out').first().getAttribute('role'), 'status');
    await page.waitForFunction(() => document.querySelectorAll('.fade-in-out').length === 0);
    assert.match(await page.locator('#cart-list').textContent(), /Cookies : \(12\)/);
  });
}
