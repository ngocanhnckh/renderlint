// Edge cases that never render on load: long data, declared worst cases, data from an API, UI states, mocked responses.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures/stress');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (file, config = {}) => check({
  targets: [join(dir, file)], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, ...config },
});
const fragile = (res, profile) => res.issues.filter((i) => i.rule === 'fragile-layout' && i.details && i.details.profile === profile);
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector}`).join('\n');

test('long unbreakable words: a short sample email that a real one would overflow', async () => {
  const res = await run('long-words.html');
  assert.equal(res.stats.errors, 0, dump(res));
  assert.ok(fragile(res, 'long-words').some((i) => /email/.test(i.selector)), dump(res));
  assert.equal(fragile(res, 'longer').length, 0, 'repeating words with spaces wraps fine: ' + dump(res));
});

test('declared worst case (data-renderlint-maxlength) fails the run', async () => {
  const res = await run('declared.html');
  const hits = fragile(res, 'declared');
  assert.ok(hits.length && hits.every((i) => i.severity === 'error'), dump(res));
});

test('data stress: API data rendered by the app is lengthened through its own code path', async () => {
  const res = await run('data.html');
  assert.equal(res.stats.errors, 0, dump(res));
  assert.ok(fragile(res, 'data').some((i) => /item/.test(i.selector)), dump(res));
  const off = await run('data.html', { stressData: false });
  assert.equal(fragile(off, 'data').length, 0);
});

test('states: a dialog that only opens on click is checked', async () => {
  const plain = await run('states.html');
  assert.ok(!plain.issues.some((i) => i.rule === 'emoji'), dump(plain));
  const res = await run('states.html', { states: [{ name: 'invite dialog', click: '#open' }] });
  const hit = res.issues.find((i) => i.rule === 'emoji');
  assert.ok(hit && hit.pages.some((p) => /\[state: invite dialog\]/.test(p)), dump(res));
});

test('mock: an API response shape the app does not handle', async () => {
  const res = await run('states.html', { mock: { '**/api/summary': {} } });
  assert.ok(res.issues.some((i) => i.rule === 'placeholder-text' && /undefined/.test(i.message)), dump(res));
});

test('responsive sweep: a KPI row that fits at 375/768/1280 but not at 1024', async () => {
  const res = await run('kpi.html', { viewports: [375, 768, 1280], sweep: true });
  const hit = res.issues.find((i) => i.severity === 'error' && /text-(crowding|overflow|clipped)/.test(i.rule));
  assert.ok(hit, dump(res));
  assert.ok(hit.viewports.every((w) => ![375, 768, 1280].includes(w)), 'only in-between widths: ' + hit.viewports);
  const off = await run('kpi.html', { viewports: [375, 768, 1280], sweep: false });
  assert.equal(off.stats.errors, 0, dump(off));
});

test('big numbers: KPI values with three more digits', async () => {
  const res = await run('kpi.html', { sweep: false });
  assert.ok(fragile(res, 'big-numbers').length, dump(res));
});
