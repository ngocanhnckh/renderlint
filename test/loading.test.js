// Loading states (default pass) and the UX pass (--ux): pages served from test/fixtures/loading,
// their data from orders.json, held / failed / mocked by renderlint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { testValue } from '../src/ux.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures/loading');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (file, extra = {}) => check({
  targets: [join(dir, file)], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [375], colorSchemes: ['light'], sweep: false, stress: false, ...extra },
});
const UX_RULES = ['loading-state', 'layout-shift', 'action-feedback', 'ui-freeze', 'error-feedback', 'double-submit', 'dead-control', 'slow-render'];
const found = (res) => res.issues.filter((i) => UX_RULES.includes(i.rule));
const dump = (res) => found(res).map((i) => `${i.rule}: ${i.message}`).join('\n');

test('a list that stays blank while its data loads: loading-state, a warning that says where and what to do', async () => {
  const res = await run('blank.html');
  const f = found(res);
  assert.deepEqual(f.map((i) => i.rule), ['loading-state'], dump(res));
  assert.equal(f[0].severity, 'warn');
  assert.match(f[0].message, /orders\.json/);
  assert.match(f[0].message, /#1040/);
  assert.match(f[0].message, /#list/);
  assert.match(f[0].message, /skeleton/);
});

for (const file of ['skeleton.html', 'spinner.html', 'text.html']) {
  test(`a loading state shown while waiting (${file}): nothing reported`, async () => {
    const res = await run(file);
    assert.deepEqual(found(res), [], dump(res));
  });
}

test('a banner pushed in above the content when the data arrives: layout-shift', async () => {
  const res = await run('shift.html');
  assert.deepEqual(found(res).map((i) => i.rule), ['layout-shift'], dump(res));
});

test('loading: false skips the pass', async () => {
  const res = await run('blank.html', { loading: false });
  assert.deepEqual(found(res), []);
});

test('--ux: each kind of action is clicked and judged', async () => {
  const res = await run('actions.html', { ux: true });
  const by = (rule) => found(res).filter((i) => i.rule === rule);
  const labels = (rule) => by(rule).map((i) => i.details.action).sort();
  const all = dump(res);
  assert.deepEqual(labels('action-feedback'), ['Refresh', 'Save changes'], all);
  assert.deepEqual(labels('double-submit'), ['Save changes'], all);
  assert.deepEqual(labels('dead-control'), ['Export CSV'], all);
  assert.deepEqual(labels('ui-freeze'), ['Generate report'], all);
  assert.deepEqual(labels('error-feedback'), ['Refresh', 'Save changes'], all);
  assert.ok(by('error-feedback').every((i) => /HTTP 500/.test(i.message)), all);
  assert.deepEqual(by('loading-state'), [], all); // the page's own load shows a skeleton
  assert.ok(found(res).every((i) => i.severity === 'warn'));
  assert.match(by('double-submit')[0].message, /POST \/api\/settings twice/);
});

test('test data for forms', () => {
  assert.equal(testValue({ type: 'email', name: 'x', label: '', autocomplete: '' }), 'test.user@example.com');
  assert.equal(testValue({ type: 'text', name: 'phone', label: '', autocomplete: '' }), '+15550100100');
  assert.equal(testValue({ type: 'number', name: 'qty', label: '', autocomplete: '', min: '3' }), '3');
  assert.equal(testValue({ type: 'text', name: 'title', label: 'Title', autocomplete: '', minLength: 8 }), 'Testxxxx');
  assert.equal(testValue({ type: 'text', name: '', label: 'Full name', autocomplete: '' }), 'Test User');
});
