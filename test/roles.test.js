// Every page as every role, frontend only: routes read from the app's router (React Router, Vue Router,
// Angular), dynamic routes filled in, and pages a role isn't shown reported instead of passed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';
import { forgeJwt, normalizeAuth, storageValue } from '../src/auth.js';
import { normalize, DEFAULTS } from '../src/config.js';
import { fillParams, notShownFindings, pagePatterns, patternRegex, redirectedTo, routeOf } from '../src/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser, srv;
before(async () => { browser = await launchBrowser(); srv = await serveStatic(join(here, 'fixtures/roles'), { spa: true }); });
after(async () => { await browser.close(); await srv.close(); });

const USERS = [{ id: 7, name: 'Grace Hopper' }, { id: 9, name: 'Linus Torvalds' }];
const API = {
  '**/api/stats': { signups: 12 },
  '**/api/users': USERS,
  '**/api/users/404': {},
  '**/api/users/*': { id: 7, name: 'Grace Hopper', email: 'grace.hopper@navy-research.example.com' },
};
const run = (paths, config = {}) => check({
  targets: paths.map((p) => srv.url + p), browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, stressData: false, maxPages: 30, mock: API, ...config },
});
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.pages} ${i.selector || ''}`).join('\n') + '\n' + JSON.stringify(res.coverage, null, 1);
const found = (res, cls) => res.issues.find((i) => i.selector && i.selector.includes(cls));
const notShown = (res) => res.issues.filter((i) => i.rule === 'page-not-shown');
const cell = (res, route, role) => { const r = res.coverage.pages.find((p) => p.route === route); return r && r.roles[role]; };

const ROLES = {
  react: {
    admin: { storage: { localStorage: { 'rr.token': { $jwt: { name: 'Ada Admin', role: 'admin' } } } } },
    viewer: { storage: { localStorage: { 'rr.token': { $jwt: { name: 'Vic Viewer', role: 'viewer' } } } } },
  },
  vue: {
    admin: { storage: { localStorage: { 'vue.auth': { token: 't', user: { name: 'Ada Admin', role: 'admin' } } } } },
    viewer: { storage: { localStorage: { 'vue.auth': { token: 't', user: { name: 'Vic Viewer', role: 'viewer' } } } } },
  },
  angular: {
    admin: { mock: { '**/api/me': { name: 'Ada Admin', role: 'admin' } } },
    viewer: { mock: { '**/api/me': { name: 'Vic Viewer', role: 'viewer' } } },
  },
};

// Every page × every role: role pages' defects found under the right role, forbidden pages reported.
function assertEveryPageEveryRole(res, { prefix }) {
  const all = ['/dashboard', '/users', '/users/7', '/admin', '/billing', '/export', '/settings/profile'];
  for (const route of all) for (const role of ['admin', 'viewer']) assert.ok(cell(res, route, role), `${route} as ${role} was not visited\n${dump(res)}`);
  for (const route of all.filter((r) => r !== '/admin' && r !== '/billing')) for (const role of ['admin', 'viewer']) assert.equal(cell(res, route, role), 'checked', `${route} as ${role}\n${dump(res)}`);
  // planted defects, each on a page only one role (or a page only the router knows of) shows
  assert.deepEqual(found(res, 'upgrade-badge').pages, [prefix + '/dashboard [role: viewer]'], dump(res));
  assert.deepEqual(found(res, 'admin-stat-caption').pages, [prefix + '/admin [role: admin]'], dump(res));
  assert.deepEqual(found(res, 'plan-pill').pages, [prefix + '/billing [role: admin]'], dump(res));
  assert.ok(found(res, 'email-chip').pages.includes(prefix + '/users/7 [role: viewer]'), dump(res));
  assert.ok(found(res, 'export-hint').pages.includes(prefix + '/export [role: admin]'), dump(res)); // no link: reached through the router table
  // the viewer was not shown /admin (redirected) nor /billing (denied in place): reported, not passed
  assert.equal(cell(res, '/admin', 'viewer'), '→ /dashboard');
  assert.equal(cell(res, '/billing', 'viewer'), 'Access denied');
  const ns = notShown(res);
  assert.equal(ns.length, 2, dump(res));
  assert.ok(ns.every((i) => i.severity === 'warn' && i.pages.length === 1 && i.pages[0].endsWith('[role: viewer]')), dump(res));
  assert.match(ns.find((i) => /\/admin/.test(i.message)).message, /for role "viewer": the app redirected to \/dashboard \(role "admin" sees it\)/);
  assert.match(ns.find((i) => /\/billing/.test(i.message)).message, /showed "Access denied" in its place/);
  // ordinary redirects (/ → /dashboard, /settings → /settings/profile) are not findings
  assert.ok(!ns.some((i) => /^\/ |\/settings /.test(i.message)), dump(res));
  // nothing the viewer didn't see is checked in its name
  assert.ok(!res.issues.some((i) => i.rule !== 'page-not-shown' && i.pages.some((p) => /\/(admin|billing) \[role: viewer\]/.test(p))), dump(res));
}

test('React Router data router, JWT claims decoded in the frontend: every page × every role', async () => {
  const res = await run(['/'], { auth: { roles: ROLES.react } });
  assert.equal(res.coverage.framework, 'react-router');
  assertEveryPageEveryRole(res, { prefix: '' });
  // user rows open with a click: /users/7 came from the API data
  assert.ok(!res.pages.some((p) => p.path.startsWith('/users/9')), 'one value per dynamic route');
});

test('Vue Router (hash), persisted Pinia store: every page × every role', async () => {
  const res = await run(['/vue.html#/dashboard'], { auth: { roles: ROLES.vue } });
  assert.equal(res.coverage.framework, 'vue');
  assertEveryPageEveryRole(res, { prefix: '/vue.html#' });
});

test('Angular Router (hash), role from /api/me per role: every page × every role', async () => {
  const res = await run(['/angular.html#/dashboard'], { auth: { storage: { sessionStorage: { 'ng.token': 'test' } }, roles: ROLES.angular }, params: { id: '7' } });
  assert.equal(res.coverage.framework, 'angular');
  assertEveryPageEveryRole(res, { prefix: '/angular.html#' });
});

test('deny: a page a role is not meant to see is recorded as denied, not reported', async () => {
  const roles = { admin: ROLES.react.admin, viewer: { ...ROLES.react.viewer, deny: ['/admin', '/billing'] } };
  const res = await run(['/'], { auth: { roles } });
  assert.equal(notShown(res).length, 0, dump(res));
  assert.equal(cell(res, '/admin', 'viewer'), 'denied (expected)');
  assert.equal(cell(res, '/billing', 'viewer'), 'denied (expected)');
  assert.ok(found(res, 'admin-stat-caption'), dump(res));
});

test('one role (no roles): a role guard\'s redirect and "Access denied" in place are reported, not passed', async () => {
  const res = await run(['/dashboard', '/admin', '/billing'], { crawl: false, auth: ROLES.react.viewer });
  const ns = notShown(res);
  assert.equal(ns.length, 2, dump(res));
  assert.ok(ns.every((i) => i.severity === 'error'), 'pages you listed');
  assert.match(ns.find((i) => i.pages.includes('/admin')).message, /\/admin was not checked: the app redirected to \/dashboard/);
  assert.match(ns.find((i) => i.pages.includes('/billing')).message, /showed "Access denied"/);
  // before: the dashboard's defect was reported as /admin's, and /billing passed
  assert.deepEqual(found(res, 'upgrade-badge').pages, ['/dashboard'], dump(res));
});

test('ordinary redirects and trailing slashes are not reported', async () => {
  const res = await run(['/', '/dashboard/', '/settings', '/users'], { crawl: false, auth: ROLES.react.admin });
  assert.equal(notShown(res).length, 0, dump(res));
  assert.ok(res.pages.some((p) => /^\/dashboard\/?$/.test(p.path)), JSON.stringify(res.pages.map((p) => p.path)));
});

test('a dynamic route filled with a value that does not exist: reported, with a hint to set params', async () => {
  const res = await run(['/'], { auth: ROLES.react.admin, params: { '/users/:id': ['404'] } });
  const hit = notShown(res).find((i) => /\/users\/404/.test(i.message));
  assert.ok(hit, dump(res));
  assert.match(hit.message, /showed "Page not found".*set "params"/);
});

test('routes: false keeps the link crawl only', async () => {
  const res = await run(['/'], { auth: ROLES.react.admin, routes: false });
  assert.ok(!res.pages.some((p) => p.path === '/export'), JSON.stringify(res.pages.map((p) => p.path)));
});

test('auth.roles config', () => {
  const a = normalizeAuth({ storage: { sessionStorage: { t: '1' } }, roles: { admin: { mock: { '**/api/me': { role: 'admin' } } }, viewer: { deny: ['/admin/**'], storage: { localStorage: { x: 'y' } } } } });
  assert.deepEqual(Object.keys(a.roles), ['admin', 'viewer']);
  assert.deepEqual(a.roles.admin.storage, { sessionStorage: { t: '1' } }, 'shared settings');
  assert.deepEqual(a.roles.viewer.storage, { localStorage: { x: 'y' } }, 'a role overrides them');
  assert.deepEqual(a.roles.viewer.deny, ['/admin/**']);
  assert.throws(() => normalizeAuth({ roles: {} }), /must map role names/);
  assert.throws(() => normalizeAuth({ roles: { admin: {} } }), /auth\.roles\.admin" needs "login", "storage"/);
  assert.throws(() => normalizeAuth({ roles: { 'a b': { storage: {} } } }), /may only use/);
});

test('forged JWTs', () => {
  const t = forgeJwt({ role: 'admin' });
  const [h, p, s] = t.split('.');
  assert.equal(s, '');
  assert.equal(JSON.parse(Buffer.from(h, 'base64url')).alg, 'none');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  assert.equal(claims.role, 'admin');
  assert.ok(claims.exp > Date.now() / 1000 + 10 * 365 * 86400);
  assert.match(storageValue({ $jwt: { role: 'viewer' } }), /^eyJ[\w-]+\.eyJ[\w-]+\.$/);
  const persisted = JSON.parse(storageValue({ token: { $jwt: { sub: '1' } }, user: { role: 'viewer' } }));
  assert.equal(persisted.user.role, 'viewer');
  assert.match(persisted.token, /^eyJ/);
  // a mocked login API that returns a token, per role
  const c = normalize({ ...DEFAULTS, mock: { '**/api/login': { token: { $jwt: { role: 'admin' } } } }, auth: { roles: { v: { storage: {}, mock: { '**/api/login': { status: 200, json: { token: { $jwt: { role: 'viewer' } } } } } } } } });
  assert.match(c.mock['**/api/login'].token, /^eyJ/);
  assert.equal(JSON.parse(Buffer.from(c.auth.roles.v.mock['**/api/login'].json.token.split('.')[1], 'base64url')).role, 'viewer');
});

test('routeOf / redirectedTo: what counts as being sent elsewhere', () => {
  const r = (a, b) => redirectedTo('https://app.test' + a, 'https://app.test' + b);
  assert.equal(r('/admin', '/dashboard'), '/dashboard');
  assert.equal(r('/#/admin', '/#/dashboard'), '/dashboard');
  assert.equal(r('/dashboard', '/dashboard/'), null, 'trailing slash');
  assert.equal(r('/dashboard/', '/dashboard'), null);
  assert.equal(r('/index.html', '/'), null);
  assert.equal(r('/users?page=2', '/users?page=1'), null, 'query');
  assert.equal(r('/settings', '/settings/profile'), null, 'a section\'s default child');
  assert.equal(r('/', '/#/dashboard'), null, 'a hash app starting');
  assert.equal(r('/dashboard', '/en/dashboard'), null, 'a locale prefix');
  assert.equal(r('/de-DE/pricing', '/pricing'), null);
  assert.equal(r('/Dashboard', '/dashboard'), null, 'case');
  assert.equal(r('/en/admin', '/en/dashboard'), '/en/dashboard');
  assert.equal(r('/admin', '/ad/dashboard'), '/ad/dashboard', 'not a locale of the same page');
  assert.equal(r('/', '/dashboard'), '/dashboard', 'reported only by the caller\'s rules (a root redirect is ordinary)');
  assert.equal(routeOf('https://app.test/#/users/7?tab=1'), '/users/7');
  assert.equal(routeOf('https://app.test/a%20b/'), '/a b');
});

test('pagePatterns / patternRegex / fillParams', () => {
  const pats = pagePatterns({ routes: [
    { path: '/', page: false, redirect: true }, { path: '/users/:id', page: true }, { path: '/docs/:slug?', page: true },
    { path: '/*', page: true, catchAll: true }, { path: '/a', page: true }, { path: '/a', page: true },
  ] });
  assert.deepEqual(pats, ['/users/:id', '/docs', '/a']);
  assert.ok(patternRegex('/users/:id').test('/users/7'));
  assert.ok(!patternRegex('/users/:id').test('/users/7/edit'));
  assert.ok(patternRegex('/files/:path(.*)*').test('/files/a/b'));
  // config first, then links, then API data
  assert.deepEqual(fillParams('/users/:id', { params: { '/users/:id': ['1', '2'] } }).paths, ['/users/1', '/users/2']);
  assert.deepEqual(fillParams('/users/:id', { params: { id: 3 } }).paths, ['/users/3']);
  assert.deepEqual(fillParams('/orgs/:org/repos/:repo', { params: { '/orgs/:org/repos/:repo': [{ org: 'acme', repo: 'web' }] } }).paths, ['/orgs/acme/repos/web']);
  assert.deepEqual(fillParams('/users/:id', { links: ['/users', '/users/42'], data: [{ url: '/api/users', json: USERS }] }), { paths: ['/users/42'], from: 'links' });
  assert.deepEqual(fillParams('/users/:id', { data: [{ url: 'http://x/api/stats', json: [{ id: 1 }] }, { url: 'http://x/api/users?page=1', json: { items: USERS } }] }), { paths: ['/users/7'], from: 'data' });
  assert.deepEqual(fillParams('/products/:productId', { data: [{ url: '**/api/products', json: [{ id: 'p-1' }] }] }).paths, ['/products/p-1']);
  assert.deepEqual(fillParams('/users/:id', { data: [{ url: '/api/orders', json: [{ id: 5 }] }] }), { missing: ['id'] }, 'no guessing from unrelated data');
});

test('notShownFindings: who saw what', () => {
  const o = (route, roles, extra = {}) => ({ url: 'https://app.test' + route, route, source: 'router', page: true, roles, ...extra });
  const shown = null, redirect = (to) => ({ kind: 'redirect', to }), denied = { kind: 'denied', text: 'Access denied' };
  const f = notShownFindings([
    o('/admin', { admin: shown, viewer: redirect('/dashboard') }),
    o('/billing', { admin: shown, viewer: denied }),
    o('/', { admin: redirect('/dashboard'), viewer: redirect('/dashboard') }, { page: false, source: 'listed' }),
    o('/old', { admin: redirect('/new'), viewer: redirect('/new') }, { page: false, source: 'link' }),
    o('/dashboard', { admin: shown, viewer: shown }),
    o('/reports', { admin: redirect('/dashboard'), viewer: redirect('/dashboard') }), // a rendered route nobody sees
  ], { roles: ['admin', 'viewer'], deny: { viewer: ['/billing'] }, multi: true });
  assert.deepEqual(f.map((x) => `${x.details.route} ${x.role} ${x.severity}`), ['/admin viewer warn', '/reports admin warn', '/reports viewer warn']);
});
