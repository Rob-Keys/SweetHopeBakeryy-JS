// Wait for asynchronous page content before treating a screenshot as verification.
export async function preparePreviewPage(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 45000 });
  if (await page.locator('[data-retry]').count()) throw new Error('The preview page could not load its content.');
  await page.addStyleTag({ content: '.cv-auto { content-visibility: visible !important; }' });
  const broken = await page.evaluate(async () => {
    const images = Array.from(document.images).filter(image => image.getAttribute('src'));
    images.forEach(image => { image.loading = 'eager'; });
    return Promise.all(images.map(async image => {
      let timer;
      try {
        await Promise.race([
          image.decode(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Image timed out')), 10000); })
        ]);
        return null;
      } catch { return image.getAttribute('src'); }
      finally { clearTimeout(timer); }
    }));
  });
  if (broken.some(Boolean)) throw new Error(`Preview images could not load: ${broken.filter(Boolean).join(', ')}`);
}
