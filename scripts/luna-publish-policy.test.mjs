import test from 'node:test';
import assert from 'node:assert/strict';
import { isAutonomousPublishPath } from './luna-publish-policy.mjs';

test('allows static presentation styles and image assets', () => {
  for (const path of [
    'src/styles/home.css',
    'src/images/home/collage.avif',
    'src/images/sweethopebakeryy.ico'
  ]) assert.equal(isAutonomousPublishPath(path), true, path);
});

test('requires human review for executable, backend, routing, and deployment paths', () => {
  for (const path of [
    'functions/api/codex/tasks.js',
    'functions/api/new-route.js',
    'functions/api/_auth.js',
    'src/js/pages/home.js',
    'src/index.html',
    'src/_routes.json',
    'src/_headers',
    'wrangler.toml',
    '.github/workflows/luna-agent.yml',
    'scripts/publish-luna-cloud.mjs'
  ]) assert.equal(isAutonomousPublishPath(path), false, path);
});

test('rejects active or malformed asset paths', () => {
  for (const path of [
    'src/images/home/active.svg',
    'src/images/../functions/api/new-route.js',
    'src/styles/../js/auth.js',
    'src/styles/home.css\\nfunctions/api/new-route.js',
    '../src/styles/home.css'
  ]) assert.equal(isAutonomousPublishPath(path), false, path);
});

test('rejects symlinked presentation paths', () => {
  assert.equal(isAutonomousPublishPath('src/styles/home.css', '120000'), false);
  assert.equal(isAutonomousPublishPath('src/images/home/collage.avif', '120000'), false);
});
