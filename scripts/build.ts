import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const sourceRoot = 'src';
const outputRoot = 'dist';
const pageRoot = join(sourceRoot, 'js/pages');
const entries = [];
for (const extension of ['js', 'ts', 'tsx']) {
  for await (const name of new Bun.Glob(`*.${extension}`).scan({ cwd: pageRoot })) {
    entries.push(join(pageRoot, name));
  }
}

if (!entries.length) throw new Error('No browser page entry points were found.');

const contentHash = contents => createHash('sha256').update(contents).digest('hex').slice(0, 12);

await rm(outputRoot, { recursive: true, force: true });
await cp(sourceRoot, outputRoot, { recursive: true });
await rm(join(outputRoot, 'data'), { recursive: true, force: true });
await rm(join(outputRoot, 'js'), { recursive: true, force: true });
await mkdir(join(outputRoot, 'js'), { recursive: true });

// Fingerprint copied CSS files and remember the output URLs for HTML rewriting.
const stylesheetDirectory = join(outputRoot, 'styles');
const stylesheetFiles = await readdir(stylesheetDirectory);
const stylesheetNames = new Map();
for (const filename of stylesheetFiles.filter(name => name.endsWith('.css'))) {
  const sourcePath = join(stylesheetDirectory, filename);
  const contents = await readFile(sourcePath);
  const outputName = filename.replace(/\.css$/, `-${contentHash(contents)}.css`);
  await rename(sourcePath, join(stylesheetDirectory, outputName));
  stylesheetNames.set(filename, outputName);
}

const result = await Bun.build({
  entrypoints: entries,
  outdir: join(outputRoot, 'js'),
  root: pageRoot,
  target: 'browser',
  splitting: true,
  minify: true,
  naming: {
    entry: '[name]-[hash].[ext]',
    chunk: 'chunks/[name]-[hash].[ext]'
  }
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Bun could not bundle the browser assets.');
}

// Fingerprinted entry names change only when their output changes. Keep HTML
// page paths stable, but point each page at the matching CSS and JS versions.
const javascriptDirectory = join(outputRoot, 'js');
const javascriptFiles = await readdir(javascriptDirectory);
const javascriptNames = new Map();
for (const entry of entries) {
  const sourceName = `${basename(entry).replace(/\.[^.]+$/, '')}.js`;
  const prefix = `${sourceName.replace(/\.js$/, '')}-`;
  const outputName = javascriptFiles.find(name => name.startsWith(prefix) && name.endsWith('.js'));
  if (!outputName) throw new Error(`Missing hashed JavaScript entry for ${sourceName}.`);
  javascriptNames.set(sourceName, outputName);
}

const htmlFiles = (await readdir(outputRoot)).filter(name => name.endsWith('.html'));
for (const filename of htmlFiles) {
  const htmlPath = join(outputRoot, filename);
  let html = await readFile(htmlPath, 'utf8');
  for (const [sourceName, outputName] of stylesheetNames) {
    html = html.replaceAll(`/styles/${sourceName}`, `/styles/${outputName}`);
  }
  for (const [sourceName, outputName] of javascriptNames) {
    html = html.replaceAll(`/js/${sourceName}`, `/js/${outputName}`);
  }
  await writeFile(htmlPath, html);
}

console.log(`Built ${entries.length} fingerprinted browser entry points and copied static assets to ${outputRoot}/.`);
