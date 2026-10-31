// What renderlint never does on its own: open a link that may change data, or keep quiet about a
// password written into a config file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';
import { looksDestructive } from '../src/runner.js';
import { literalSecrets, loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser, srv;
before(async () => { browser = await launchBrowser(); srv = await serveStatic(join(here, 'fixtures/destructive'), { spa: true }); });
after(async () => { await browser.close(); await srv.close(); });

test('looksDestructive: path segments, query keys and values; not words inside a slug', () => {
  const d = (p) => looksDestructive('https://app.test' + p);
  for (const p of ['/orders/3/delete', '/delete', '/account/delete-account', '/users/7/remove', '/cart?action=remove&item=3', '/cart?remove=3', '/newsletter/unsubscribe?t=x', '/sub/cancel', '/orders/3/cancel-order', '/account/reset', '/keys/9/revoke', '/account_deactivate', '/#/items/3/delete', '/data/purge', '/x?op=destroy']) assert.ok(d(p), p);
  for (const p of ['/', '/orders/3', '/blog/how-to-remove-stains', '/removals', '/dropdown-demo', '/settings', '/cancellation-policy', '/x?sort=deleted_at', '/products?page=2']) assert.ok(!d(p), p);
});

test('the crawl never opens a link that looks like it changes data; a listed one is checked', async () => {
  const run = (paths) => check({
    targets: paths.map((p) => srv.url + p), browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
    config: { screenshots: false, outputDir: join(here, '.tmp/destructive'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, stressData: false, routes: false },
  });
  const res = await run(['/']);
  const paths = res.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/', '/blog/how-to-remove-stains', '/orders/3'], paths.join(' '));
  const skipped = res.roleCoverage.skipped.map((s) => s.route).sort();
  assert.deepEqual(skipped, ['/account/reset', '/cart?action=remove&item=3', '/newsletter/unsubscribe?t=abc123', '/orders/3/cancel-order', '/orders/3/delete']);
  const listed = await run(['/orders/3/delete']);
  assert.ok(listed.pages.some((p) => p.path === '/orders/3/delete'), 'a page you list is opened');
});

test('literal secrets in a config file: passwords and real-looking tokens, not placeholders or ${ENV}', async () => {
  assert.deepEqual(literalSecrets({ auth: { login: '/login', user: 'qa', password: 'hunter2' } }), ['auth.password']);
  assert.deepEqual(literalSecrets({ auth: { login: '/login', user: 'qa', password: '${RENDERLINT_PASSWORD}' } }), []);
  assert.deepEqual(literalSecrets({ auth: { storage: { localStorage: { token: 'test', user: { $jwt: { role: 'admin' } } } } } }), []);
  assert.deepEqual(literalSecrets({ roles: { admin: { storage: { localStorage: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln' }, cookies: [{ name: 'session', value: 'a8f9d0c1b2e3f4a5b6c7d8e9' }] } } } }).sort(), ['roles.admin.storage.cookies.0.value', 'roles.admin.storage.localStorage.token']);
  assert.deepEqual(literalSecrets({ auth: { login: { page: '/login', fill: { 'input[name=password]': 'pw1' } } } }), ['auth.login.fill.input[name=password]']);
  assert.deepEqual(literalSecrets({ auth: { password: 'from-env-1' } }, 'export default { auth: { password: process.env.PW } }'), [], 'read from the environment in a JS config');
  // loading a config file warns, and still loads
  const dir = mkdtempSync(join(tmpdir(), 'rl-secret-'));
  writeFileSync(join(dir, 'renderlint.config.json'), JSON.stringify({ auth: { login: '/login', user: 'qa', password: 'hunter2' } }));
  const warn = console.warn, seen = [];
  console.warn = (m) => seen.push(String(m));
  try { const { config } = await loadConfig(dir); assert.equal(config.auth.password, 'hunter2'); } finally { console.warn = warn; }
  assert.ok(seen.some((m) => /auth\.password is written out in renderlint\.config\.json/.test(m)), seen.join('\n'));
});
