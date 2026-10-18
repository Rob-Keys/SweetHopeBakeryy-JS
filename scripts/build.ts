import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

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

await rm(outputRoot, { recursive: true, force: true });
await cp(sourceRoot, outputRoot, { recursive: true });
await rm(join(outputRoot, 'data'), { recursive: true, force: true });
await rm(join(outputRoot, 'js'), { recursive: true, force: true });
await mkdir(join(outputRoot, 'js'), { recursive: true });

const result = await Bun.build({
  entrypoints: entries,
  outdir: join(outputRoot, 'js'),
  root: pageRoot,
  target: 'browser',
  splitting: true,
  minify: true,
  naming: {
    entry: '[name].js',
    chunk: 'chunks/[name]-[hash].[ext]'
  }
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error('Bun could not bundle the browser assets.');
}

console.log(`Built ${entries.length} browser entry points and copied static assets to ${outputRoot}/.`);
