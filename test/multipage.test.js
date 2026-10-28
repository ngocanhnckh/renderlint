// Whole-site runs: pages checked side by side, pages that render alike sharing their checks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures/multipage');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (config = {}) => check({
  targets: [dir], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: [1024], concurrency: 4, ...config },
});
const keys = (res) => res.issues.map((i) => [i.rule, i.severity, i.selector, i.pages.slice().sort().join(','), i.viewports.slice().sort().join('/')].join(' | ')).sort();
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector} on ${i.pages}`).join('\n');
const runsOf = (res, path) => res.pages.find((p) => p.path === path).runs;

test('pages that render identically share their checks and report the same findings', async () => {
  const res = await run();
  const full = await run({ dedupe: false });
  assert.deepEqual(res.pages.map((p) => p.path), full.pages.map((p) => p.path), 'the same pages, in the same order');
  assert.deepEqual(keys(res), keys(full), dump(res) + '\n---\n' + dump(full));
  for (const p of ['/a', '/b']) assert.equal(runsOf(res, p)[0].sharedWith, '/index.html', p);
  assert.ok(!runsOf(res, '/post-2.html')[0].sharedWith, 'a different page is checked on its own');
  const sweep = res.issues.find((i) => i.viewports.includes(1024) && /text-/.test(i.rule));
  assert.ok(sweep && ['/a', '/b', '/index.html'].every((p) => sweep.pages.includes(p)), 'sweep finding listed on every copy: ' + dump(res));
});

test('dedupe: "template" runs only the base checks on later pages built from the same template', async () => {
  const res = await run({ dedupe: 'template' });
  assert.equal(runsOf(res, '/post-2.html')[0].templateOf, '/post-1.html');
  // a per-page content defect visible at a checked viewport is still found on that page
  assert.ok(res.issues.some((i) => i.severity === 'error' && /text-overflow|content-overflow/.test(i.rule) && i.pages.includes('/post-2.html') && /h1/.test(i.selector)), dump(res));
});
