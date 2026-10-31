// Pages behind a login: an SPA whose route guard reads a token from sessionStorage (the Angular pattern).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';
import { loginRedirect, normalizeAuth, resolveEnv } from '../src/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser, srv;
before(async () => { browser = await launchBrowser(); srv = await serveStatic(join(here, 'fixtures/auth'), { spa: true }); });
after(async () => { await browser.close(); await srv.close(); });

const API = { '**/api/me': { name: 'Dana' }, '**/api/reports': [{ title: 'Q3 revenue' }, { title: 'Churn by plan' }] };
const run = (paths, config = {}) => check({
  targets: paths.map((p) => srv.url + p), browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, ...config },
});
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.pages} ${i.selector || ''}`).join('\n');
const badge = (res) => res.issues.find((i) => /text-(overflow|crowding|clipped)/.test(i.rule) && /badge/.test(i.selector));

test('without auth: a guarded page is reported, not passed with the login form checked in its place', async () => {
  const res = await run(['/dashboard']);
  const hit = res.issues.find((i) => i.rule === 'auth-required');
  assert.ok(hit && hit.severity === 'error' && hit.pages.includes('/dashboard'), dump(res));
  assert.match(hit.message, /sent renderlint to \/login/);
  assert.ok(!badge(res), dump(res));
  // the login page itself is still checked, under its own name
  assert.ok(res.pages.some((p) => p.path.startsWith('/login')), JSON.stringify(res.pages.map((p) => p.path)));
});

test('frontend only: the token the guard reads plus mocked API, no backend', async () => {
  const res = await run(['/dashboard', '/reports'], { auth: { storage: { sessionStorage: { 'demo.token': 'test' } } }, mock: API });
  assert.ok(!res.issues.some((i) => i.rule === 'auth-required'), dump(res));
  assert.ok(badge(res) && badge(res).pages.includes('/dashboard'), dump(res));
  assert.equal(res.stats.errors, 1, dump(res));
});

test('login form, with the login API mocked; crawling skips the log-out link', async () => {
  const res = await run(['/dashboard'], { crawl: true, auth: { login: '/login', user: 'demo@example.com', password: 'x' }, mock: { ...API, '**/api/login': { token: 'tok' } } });
  const paths = res.pages.map((p) => p.path);
  assert.deepEqual(paths.sort(), ['/dashboard', '/reports'], dump(res));
  assert.ok(badge(res), dump(res));
  assert.ok(!res.issues.some((i) => i.rule === 'auth-required'), dump(res));
});

test('a failed login stops the run with what the page said', async () => {
  await assert.rejects(
    run(['/dashboard'], { auth: { login: '/login', user: 'demo@example.com', password: 'wrong' }, mock: { ...API, '**/api/login': { status: 401, json: { error: 'bad' } } } }),
    /login didn't complete.*Wrong email or password/s,
  );
});

test('a token the API rejects: pages are reported as not checked', async () => {
  const res = await run(['/dashboard'], { auth: { storage: { sessionStorage: { 'demo.token': 'expired' } } }, mock: { '**/api/me': { status: 401, json: {} } } });
  const hit = res.issues.find((i) => i.rule === 'auth-required');
  assert.ok(hit, dump(res));
  assert.match(hit.message, /session from "auth" was not accepted/);
});

test('hash routing (/#/dashboard): routes are crawled as separate pages', async () => {
  const res = await run(['/hash.html#/dashboard'], { crawl: true, auth: { storage: { sessionStorage: { 'demo.token': 'test' } } }, mock: API });
  const paths = res.pages.map((p) => p.path);
  assert.deepEqual(paths.sort(), ['/hash.html#/dashboard', '/hash.html#/reports'], dump(res));
  assert.ok(badge(res), dump(res));
});

test('loginRedirect', () => {
  const r = (a, b, pw = false) => loginRedirect('https://app.test' + a, b.startsWith('http') ? b : 'https://app.test' + b, pw);
  assert.deepEqual(r('/dashboard', '/login?returnUrl=%2Fdashboard'), { to: '/login', external: false });
  assert.deepEqual(r('/settings', '/auth/sign-in'), { to: '/auth/sign-in', external: false });
  assert.deepEqual(r('/#/dashboard', '/#/login'), { to: '/#/login', external: false });
  assert.equal(r('/login', '/login'), null, 'asked for the login page');
  assert.equal(r('/', '/dashboard'), null, 'an ordinary redirect');
  assert.equal(r('/blog', '/blog/'), null);
  assert.equal(r('/pricing', 'https://www.app.test/pricing'), null, 'www');
  assert.equal(r('/account', '/welcome', true).to, '/welcome', 'a password form elsewhere');
  assert.equal(r('/docs', 'https://docs.other.test/start'), null, 'another site that is not a sign-in page');
  assert.deepEqual(r('/app', 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x'), { to: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize', external: true });
  assert.ok(r('/app', 'https://sso.example.com/realms/acme/protocol/openid-connect/auth').external);
  assert.equal(r('/blog/authors', '/blog/authors/'), null, '"auth" inside a word is not a login path');
});

test('normalizeAuth and resolveEnv', () => {
  assert.equal(normalizeAuth(undefined), null);
  assert.deepEqual(normalizeAuth({ login: '/login', user: 'u', password: 'p' }).login, { page: '/login' });
  assert.throws(() => normalizeAuth({ login: '/login' }), /needs "user" and "password"/);
  assert.throws(() => normalizeAuth({ user: 'u' }), /needs "login", "storage"/);
  assert.ok(normalizeAuth({ login: { page: '/in', fill: { '#pin': '1234' } } }));
  process.env.RL_TEST_PW = 's3cret';
  assert.equal(resolveEnv('${RL_TEST_PW}', 'auth.password'), 's3cret');
  assert.throws(() => resolveEnv('${RL_TEST_MISSING}', 'auth.password'), /RL_TEST_MISSING is not set/);
});
