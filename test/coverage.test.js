// Route coverage on a running app: routes read from its source, instances from links, the sitemap and
// API lists, a few checked per route, and a status for every route (so none is skipped silently).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, 'fixtures/coverage');
let browser, srv;
before(async () => { browser = await launchBrowser(); srv = await serveStatic(app, { spa: true }); });
after(async () => { await browser.close(); await srv.close(); });

const out = join(here, '.tmp/coverage');
const run = (config = {}) => check({
  targets: [srv.url + '/'], browser, scan: false, configFile: false, cwd: app,
  config: { screenshots: false, outputDir: out, viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, ...config },
});
const route = (res, p) => res.coverage.list.find((r) => r.pattern === p);

test('every route gets a status; dynamic routes are sampled; role guards and missing params are reported', async () => {
  const res = await run();
  const c = res.coverage;
  assert.ok(c, 'coverage report');
  assert.equal(route(res, '/').status, 'checked');
  assert.equal(route(res, '/about').status, 'checked');
  // 9 linked products + /products/10 from the sitemap: 2 checked
  const products = route(res, '/products/:id');
  assert.equal(products.status, 'checked');
  assert.equal(products.instances, 10);
  assert.equal(products.checked.length, 2);
  assert.ok(products.sources.includes('sitemap') && products.sources.includes('link'), JSON.stringify(products));
  // nothing links to members: the ids come from the API list the home page loads
  const users = route(res, '/users/:id');
  assert.equal(users.status, 'checked', JSON.stringify(users));
  assert.equal(users.instances, 4);
  assert.ok(users.sources.some((s) => s.startsWith('api ')));
  // renders "Access denied" at the same URL: not a clean page, a page that needs a role
  assert.equal(route(res, '/admin').status, 'needs-role');
  assert.match(route(res, '/admin').reason, /Access denied/);
  assert.equal(route(res, '/settings').status, 'needs-auth');
  assert.equal(route(res, '/reports/:id').status, 'needs-params');
  // in the sitemap, served by no route of the source: listed too
  assert.ok(c.list.some((r) => r.pattern === '/legacy' && r.inferred), JSON.stringify(c.list.map((r) => r.pattern)));
  assert.match(c.line, /^\d+ URL\(s\), 9 route\(s\): 6 checked, 1 need sign-in, 1 need a role, 1 need param values/);
  // tiered: every product gets the quick check (narrowest viewport, base rules), two get the full check
  assert.equal(products.quickChecked, 10);
  const full = res.pages.filter((p) => p.path.startsWith('/products/') && !p.quick);
  assert.equal(full.length, 2, res.pages.map((p) => p.path + (p.quick ? '(q)' : '')).join(' '));
  assert.ok(res.pages.filter((p) => p.quick).every((p) => p.runs.length === 1 && p.runs[0].viewport === 1280));
  const saved = JSON.parse(readFileSync(join(out, 'coverage.json'), 'utf8'));
  assert.equal(saved.routes, 9);
  const map = JSON.parse(readFileSync(join(out, 'page-map.json'), 'utf8'));
  assert.ok(map.routes.find((r) => r.pattern === '/products/:id').files.includes('src/views/Product.vue'));
});

test('coverage gate: a minimum fails the run; perRoute and params', async () => {
  const res = await run({ coverage: { min: 100, perRoute: 1, quick: false }, params: { '/reports/:id': ['r1'] } });
  assert.equal(route(res, '/reports/:id').status, 'checked');
  assert.equal(route(res, '/products/:id').checked.length, 1);
  assert.ok(!res.pages.some((p) => p.quick) && res.pages.filter((p) => p.path.startsWith('/products/')).length === 1, 'quick: false checks only perRoute instances');
  assert.equal(res.ok, false);
  assert.ok(res.coverage.gate.some((g) => /below the minimum of 100%/.test(g)), JSON.stringify(res.coverage.gate));
  const ok = await run({ coverage: { min: 50, ignore: ['/admin', '/settings'] }, params: { '/reports/:id': ['r1'] } });
  assert.deepEqual(ok.coverage.gate, []);
  assert.equal(route(ok, '/admin').status, 'excluded');
});

test('routes: false turns it off (the crawl alone, as before)', async () => {
  const res = await run({ routes: false, maxPages: 4 });
  assert.equal(res.coverage, null);
  assert.ok(res.pages.length <= 4);
});
