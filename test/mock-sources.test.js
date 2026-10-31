// "mockFrom": the project's MSW handlers or a HAR recording answer the API, no backend running.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser, srv;
before(async () => { browser = await launchBrowser(); srv = await serveStatic(join(here, 'fixtures/auth'), { spa: true }); });
after(async () => { await browser.close(); await srv.close(); });

const run = (paths, config) => check({
  targets: paths.map((p) => srv.url + p), browser, scan: false, configFile: false, cwd: here,
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, ...config },
});
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.pages} ${i.selector || ''}`).join('\n');
const badge = (res) => res.issues.find((i) => i.rule === 'text-overflow' && /badge/.test(i.selector));

test('MSW handlers answer the API (request headers included): the signed-in pages render', async () => {
  const res = await run(['/dashboard', '/reports'], { auth: { storage: { sessionStorage: { 'demo.token': 'test' } } }, mockFrom: ['fixtures/mock-sources/handlers.js'] });
  assert.ok(!res.issues.some((i) => i.rule === 'auth-required' || i.rule === 'broken-resource'), dump(res));
  assert.ok(badge(res) && badge(res).pages.includes('/dashboard'), dump(res));
  // the handler rejects another token with 401, and the app's guard sends us to the login page
  const out = await run(['/dashboard'], { auth: { storage: { sessionStorage: { 'demo.token': 'nope' } } }, mockFrom: ['fixtures/mock-sources/handlers.js'] });
  assert.ok(out.issues.some((i) => i.rule === 'auth-required'), dump(out));
});

test('a HAR recorded against another host replays its JSON (not its stale code)', async () => {
  const res = await run(['/dashboard', '/reports'], { auth: { storage: { sessionStorage: { 'demo.token': 'x' } } }, mockFrom: ['fixtures/mock-sources/recording.har'], stress: 1.5 });
  assert.ok(!res.issues.some((i) => i.rule === 'auth-required' || i.rule === 'broken-resource'), dump(res));
  assert.ok(badge(res), dump(res));
});

test('an API request no source covers is reported, so a page that rendered without its data is not passed silently', async () => {
  // a dev server whose backend is down: the proxy answers 502
  const files = join(here, 'fixtures/auth');
  const down = createServer((req, res) => {
    if (req.url.startsWith('/api/')) { res.writeHead(502); res.end('Bad gateway'); return; }
    const f = req.url === '/app.js' ? 'app.js' : 'index.html';
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
    res.end(readFileSync(join(files, f)));
  });
  await new Promise((r) => down.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${down.address().port}`;
  try {
    const cfg = { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, auth: { storage: { sessionStorage: { 'demo.token': 'x' } } } };
    // the recording has /api/me and /api/reports: nothing missing
    const ok = await check({ targets: [base + '/reports'], browser, scan: false, configFile: false, cwd: here, config: { ...cfg, mockFrom: ['fixtures/mock-sources/recording.har'] } });
    assert.ok(!ok.issues.some((i) => i.details && i.details.unmocked), dump(ok));
    // a recording of the dashboard only: /reports' data is missing
    const partial = await check({ targets: [base + '/reports'], browser, scan: false, configFile: false, cwd: here, config: { ...cfg, mockFrom: ['fixtures/mock-sources/me-only.har'] } });
    const miss = partial.issues.find((i) => i.details && i.details.unmocked);
    assert.ok(miss && miss.severity === 'warn' && /GET \/api\/reports/.test(miss.message) && miss.pages.includes('/reports'), dump(partial));
  } finally { down.close(); }
});
