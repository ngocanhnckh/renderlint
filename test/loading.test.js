// Loading states (default pass) and the UX pass (--ux): pages served from test/fixtures/loading,
// their data from orders.json, held / failed / mocked by renderlint.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { testValue } from '../src/ux.js';
import { emptyLists } from '../src/waiting.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'fixtures/loading');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (file, extra = {}, log) => check({
  targets: [join(dir, file)], browser, scan: false, configFile: false, cwd: join(here, '.tmp'), ...(log ? { log } : {}),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [375], colorSchemes: ['light'], sweep: false, stress: false, ...extra },
});
const UX_RULES = ['loading-state', 'layout-shift', 'action-feedback', 'ui-freeze', 'error-feedback', 'double-submit', 'dead-control', 'slow-render', 'empty-state', 'dialog-focus', 'back-navigation'];
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

test('text ending in "…" that is not a loading message ("More…") does not count as one', async () => {
  const res = await run('ellipsis.html');
  assert.deepEqual(found(res).map((i) => i.rule), ['loading-state'], dump(res));
});

test('a banner pushed in above the content when the data arrives: layout-shift', async () => {
  const res = await run('shift.html');
  assert.deepEqual(found(res).map((i) => i.rule), ['layout-shift'], dump(res));
});

test('loading: false skips the pass', async () => {
  const res = await run('blank.html', { loading: false });
  assert.deepEqual(found(res), []);
});

test('--ux: each kind of action is clicked and judged', async () => {
  const lines = [];
  const res = await run('actions.html', { ux: true, screenshots: true }, (m) => lines.push(m));
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
  assert.equal(by('empty-state').length, 1, all); // its list, with no orders, is just empty
  assert.ok(found(res).every((i) => i.severity === 'warn'));
  assert.match(by('double-submit')[0].message, /POST \/api\/settings twice/);
  // screenshots (on by default): side by side for the feedback and failure findings
  for (const i of [...by('action-feedback'), ...by('error-feedback')]) assert.ok(i.screenshot && existsSync(i.screenshot), `${i.rule} ${i.details.action}: ${i.screenshot}`);
  // a link to /account/delete is never followed
  assert.ok(lines.some((l) => /skipped "Delete account" \(looks destructive\)/.test(l)), lines.join('\n'));
});

test('--ux: the page\'s own data failing with nothing shown is error-feedback, with a screenshot', async () => {
  const res = await run('blank.html', { ux: true, screenshots: true });
  const e = found(res).filter((i) => i.rule === 'error-feedback');
  assert.equal(e.length, 1, dump(res));
  assert.match(e[0].message, /GET \/orders\.json with HTTP 500/);
  assert.ok(existsSync(e[0].screenshot));
  assert.deepEqual(found(res).filter((i) => i.rule === 'action-feedback' || i.rule === 'dead-control'), []);
});

test('--ux: main content behind a 4.5s request is slow-render; a mock can delay its answer', async () => {
  const res = await run('slow.html', { ux: true, mock: { '**/slow.json': { json: { summary: 'This month you processed 1,204 orders from 312 customers, with revenue up 12% on last month. Refunds stayed under 2% and the average order value rose to $40.04. Your top region was the Pacific Northwest.' }, delay: 4500 } } });
  const slow = found(res).filter((i) => i.rule === 'slow-render');
  assert.equal(slow.length, 1, dump(res));
  assert.ok(slow[0].details.lcpMs > 4000);
  assert.deepEqual(found(res).filter((i) => i.rule === 'loading-state'), [], dump(res)); // it shows a skeleton
});

test('test data for forms', () => {
  assert.equal(testValue({ type: 'email', name: 'x', label: '', autocomplete: '' }), 'test.user@example.com');
  assert.equal(testValue({ type: 'text', name: 'phone', label: '', autocomplete: '' }), '+15550100100');
  assert.equal(testValue({ type: 'number', name: 'qty', label: '', autocomplete: '', min: '3' }), '3');
  assert.equal(testValue({ type: 'text', name: 'title', label: 'Title', autocomplete: '', minLength: 8 }), 'Testxxxx');
  assert.equal(testValue({ type: 'text', name: '', label: 'Full name', autocomplete: '' }), 'Test User');
  assert.equal(testValue({ type: 'text', name: 'code', label: '', autocomplete: '', pattern: '[0-9]{5}' }), '12345');
});

test('--ux: a list with no records shows nothing: empty-state; a message, or a section left out, is fine', async () => {
  const res = await run('empty.html', { ux: true, viewports: [1280] });
  const e = found(res).filter((i) => i.rule === 'empty-state');
  assert.equal(e.length, 1, dump(res));
  assert.match(e[0].selector, /#orders/);
  assert.match(e[0].message, /orders\.json/);
  assert.match(e[0].message, /No orders yet/);
  assert.equal(e[0].severity, 'warn');
});

test('--ux: a page that breaks when a list is empty: empty-state, with the error', async () => {
  const res = await run('empty-crash.html', { ux: true });
  const e = found(res).filter((i) => i.rule === 'empty-state');
  assert.equal(e.length, 1, dump(res));
  assert.ok(e[0].details.broken, dump(res));
  assert.match(e[0].message, /items\[0\]|Cannot read/);
});

test('--ux: dialogs: focus moves in, Escape closes, focus comes back (a <dialog> with showModal() passes)', async () => {
  const res = await run('dialog.html', { ux: true, viewports: [1280] });
  const d = found(res).filter((i) => i.rule === 'dialog-focus');
  assert.deepEqual(d.map((i) => i.details.action), ['Open filters'], dump(res));
  assert.equal(d[0].details.problems.length, 3, dump(res));
  assert.match(d[0].message, /Escape/);
  assert.deepEqual(found(res).filter((i) => i.rule === 'dead-control'), [], dump(res));
});

test('--ux: Back after an in-app link: a replaced history entry, or a page that ignores popstate', async () => {
  const res = await run('back.html', { ux: true, viewports: [1280] });
  const b = found(res).filter((i) => i.rule === 'back-navigation');
  assert.deepEqual(b.map((i) => i.details.action).sort(), ['Billing', 'Team'], dump(res));
  assert.match(b.find((i) => i.details.action === 'Team').message, /replace/);
  assert.match(b.find((i) => i.details.action === 'Billing').message, /popstate/);
});

test('--ux: a filter dropdown that refetches with no sign of it: action-feedback', async () => {
  const res = await run('select.html', { ux: true, viewports: [1280] });
  const a = found(res).filter((i) => i.rule === 'action-feedback');
  assert.deepEqual(a.map((i) => i.details.action), ['Status'], dump(res));
  assert.match(a[0].message, /choosing "Paid" in the dropdown "Status"/);
});

test('emptyLists empties the records a page lists, and keeps who the user is, flags and lookup lists', () => {
  assert.deepEqual(emptyLists({ items: [{ id: 1 }, { id: 2 }], total: 2, hasMore: true }), [{ items: [], total: 0, hasMore: false }, 1]);
  assert.deepEqual(emptyLists({ data: { edges: [{ cursor: 'a', node: { id: 1 } }], totalCount: 4 } }), [{ data: { edges: [], totalCount: 0 } }, 1]);
  assert.deepEqual(emptyLists([{ orderId: 5 }]), [[], 1]);
  // the user's roles stay; their projects go
  assert.deepEqual(emptyLists({ user: { id: 1, roles: [{ id: 2, name: 'admin' }] }, projects: [{ id: 3 }] }), [{ user: { id: 1, roles: [{ id: 2, name: 'admin' }] }, projects: [] }, 1]);
  for (const j of [{ flags: [{ key: 'beta', on: true }] }, { countries: [{ code: 'US', id: 1 }] }, { permissions: [{ id: 'read' }] }, { points: [{ x: 1, y: 2 }] }, { tags: ['a', 'b'] }]) {
    assert.deepEqual(emptyLists(j), [j, 0], JSON.stringify(j));
  }
});
