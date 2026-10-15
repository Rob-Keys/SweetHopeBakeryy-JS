import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';

const origin = 'http://localhost';
const siteRoot = new URL('../src/', import.meta.url);
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, handler = () => null, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, ...options });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(() => sessionStorage.setItem('shb_auth', 'test-admin-token'));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.fulfill({ status: 204 });
    if (url.pathname.startsWith('/api/')) {
      if (await handler(route, url)) return;
      const data = url.pathname === '/api/codex/agent/status' ? { configured: true, attachmentsConfigured: true, busy: false }
        : url.pathname === '/api/get-data' ? [] : { commit: 'unknown' };
      return route.fulfill({ json: data });
    }
    const path = url.pathname === '/customize' ? 'customize.html' : url.pathname === '/authenticate' ? 'authenticate.html' : url.pathname.slice(1);
    try {
      return await route.fulfill({ contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(new URL(path, siteRoot)) });
    } catch { return route.fulfill({ status: 404 }); }
  });
  return page;
}
const status = page => page.locator('[data-agent-task]');
const submit = page => page.locator('[data-agent-submit]');
async function open(page) {
  await page.goto(`${origin}/customize`);
  await page.waitForFunction(() => !document.querySelector('[data-agent-submit]').disabled);
}
async function send(page, prompt = 'Update the welcome title') {
  await page.locator('[name="prompt"]').fill(prompt);
  await submit(page).click();
}
async function readSubmission(route) {
  const request = route.request();
  return new Request(request.url(), { method: 'POST', headers: request.headers(), body: request.postDataBuffer() }).formData();
}

test('submission saves its ID before upload and restores the result after reload', async t => {
  let id;
  let checked = 0;
  let page;
  page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/tasks') {
      const form = await readSubmission(route);
      id = form.get('taskId');
      assert.equal(JSON.parse(await page.evaluate(() => sessionStorage.getItem('luna-active-task'))).taskId, id);
      assert.equal(form.get('prompt'), 'Update the welcome title');
      assert.equal(await form.get('attachments').text(), 'reference bytes');
      await route.fulfill({ status: 202, json: { taskId: id, status: 'running' } });
      return true;
    }
    if (url.pathname === `/api/codex/tasks/${id}`) {
      checked += 1;
      await route.fulfill({ json: { taskId: id, status: 'complete', summary: 'Title updated.' } });
      return true;
    }
  });
  await open(page);
  await page.locator('[name="attachments"]').setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from('reference bytes') });
  await send(page);
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Title updated.'));
  assert.equal(await submit(page).isEnabled(), true);
  if (process.env.LUNA_TEST_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.LUNA_TEST_SCREENSHOT_DIR, 'desktop.png') });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Title updated.'));
  assert.ok(checked >= 2);
});

test('a lost submission response recovers the saved task without resubmitting', async t => {
  let id;
  let submissions = 0;
  const page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/tasks') {
      submissions += 1;
      id = (await readSubmission(route)).get('taskId');
      await route.abort('failed');
      return true;
    }
    if (url.pathname === `/api/codex/tasks/${id}`) {
      await route.fulfill({ json: { taskId: id, status: 'complete', summary: 'Recovered successfully.' } });
      return true;
    }
  });
  await open(page);
  await send(page);
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Recovered successfully.'));
  assert.equal(submissions, 1);
  assert.equal(await submit(page).isEnabled(), true);
});

test('busy requests from another tab can be followed and release the controls', async t => {
  const id = crypto.randomUUID();
  let finished = false;
  const page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/agent/status') {
      await route.fulfill({ json: { configured: true, attachmentsConfigured: true, busy: !finished, taskId: id } });
      return true;
    }
    if (url.pathname === `/api/codex/tasks/${id}`) {
      finished = true;
      await route.fulfill({ json: { taskId: id, status: 'complete', summary: 'Other request finished.' } });
      return true;
    }
  });
  await page.goto(`${origin}/customize`);
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Other request finished.'));
  assert.match(await status(page).textContent(), /another tab/);
  await page.waitForFunction(() => !document.querySelector('[data-agent-submit]').disabled);
});

test('polling failures offer a working retry without allowing duplicate requests', async t => {
  let id;
  let failing = true;
  const page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/tasks') {
      id = (await readSubmission(route)).get('taskId');
      await route.fulfill({ status: 202, json: { taskId: id } });
      return true;
    }
    if (url.pathname === `/api/codex/tasks/${id}`) {
      await route.fulfill(failing ? { status: 503, json: {} } : { json: { taskId: id, status: 'complete', summary: 'Recovered after pause.' } });
      return true;
    }
  });
  await page.clock.install();
  await open(page);
  await send(page);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.clock.runFor(30000);
  }
  const retry = page.getByRole('button', { name: 'Check request status' });
  await retry.waitFor();
  assert.equal(await submit(page).isDisabled(), true);
  failing = false;
  await retry.click();
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Recovered after pause.'));
  assert.equal(await submit(page).isEnabled(), true);
});

test('submission authentication expiry redirects and keeps recovery information', async t => {
  const page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/tasks') {
      await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      return true;
    }
  });
  await open(page);
  await send(page);
  await page.waitForURL(`${origin}/authenticate`);
  assert.ok(await page.evaluate(() => sessionStorage.getItem('luna-active-task')));
});

test('empty attachments are rejected and result text cannot inject HTML or unsafe links', async t => {
  let id;
  let submissions = 0;
  const page = await fixture(t, async (route, url) => {
    if (url.pathname === '/api/codex/tasks') {
      submissions += 1;
      id = (await readSubmission(route)).get('taskId');
      await route.fulfill({ status: 202, json: { taskId: id } });
      return true;
    }
    if (url.pathname === `/api/codex/tasks/${id}`) {
      await route.fulfill({ json: { taskId: id, status: 'uncertain', summary: '<img src=x onerror=alert(1)>', workflowRunUrl: 'javascript:alert(1)', message: 'Check the workflow before retrying.' } });
      return true;
    }
  }, { viewport: { width: 390, height: 844 } });
  await open(page);
  await page.locator('[name="attachments"]').setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: Buffer.alloc(0) });
  await page.locator('[name="prompt"]').fill('Use the image');
  await submit(page).click();
  assert.equal(submissions, 0);
  assert.match(await page.locator('[name="attachments"]').evaluate(el => el.validationMessage), /empty/);
  await page.locator('[name="attachments"]').setInputFiles([]);
  await submit(page).click();
  await page.waitForFunction(() => document.querySelector('[data-agent-task]').textContent.includes('Outcome needs checking'));
  assert.equal(await status(page).locator('img, a').count(), 0);
  assert.match(await status(page).textContent(), /<img/);
  if (process.env.LUNA_TEST_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.LUNA_TEST_SCREENSHOT_DIR, 'mobile.png') });
  assert.equal(await page.locator('.local-code-agent').evaluate(el => el.scrollWidth <= el.clientWidth), true);
  assert.equal(await page.locator('.local-code-agent-form').evaluate(form => form.elements.prompt.getBoundingClientRect().right <= form.getBoundingClientRect().right), true);
});
