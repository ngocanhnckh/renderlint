// Server-rendered apps: the login, the role check and the data fetching happen on the server, against
// an API that isn't running. renderlint starts the app ("serve") with its preload, which answers the
// server's own requests from "mock" and per role (roles.<name>.mock), chosen by a cookie per role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, 'fixtures/ssr');
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const MOCK = {
  '**/api/reports': [{ id: 1, title: 'Revenue by region' }],
  '**/api/admin/users': [{ id: 1, name: 'Ada Admin', plan: 'Enterprise annual plan' }],
  '**/api/tasks': [{ id: 7, title: 'Review the checklist', status: 'Waiting for approval' }],
};
const ROLES = {
  admin: { mock: { '**/api/auth/login': { token: 't-admin' }, '**/api/me': { name: 'Ada Admin', role: 'admin' } } },
  viewer: { mock: { '**/api/auth/login': { token: 't-viewer' }, '**/api/me': { name: 'Vic Viewer', role: 'viewer' } } },
};
const AUTH = { login: '/login', user: 'qa@example.com', password: 'any' };
let n = 0;
const run = (config) => check({
  cwd: app, browser, scan: false, configFile: false,
  config: { serve: 'node server.mjs', pages: ['/dashboard'], crawl: false, screenshots: false, outputDir: join(here, '.tmp', 'ssr-' + n++), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false, mock: MOCK, auth: AUTH, ...config },
});
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.pages} ${i.selector || ''}`).join('\n');
const on = (res, cls, page) => res.issues.find((i) => /text-(overflow|crowding|clipped)/.test(i.rule) && i.selector && i.selector.includes(cls) && i.pages.includes(page));

test('browser-side mocks alone never reach an SSR server: its login fails', async () => {
  await assert.rejects(run({ serverMock: false, roles: ROLES }), /login didn't complete/);
});

test('every role, every page: role-only pages render on the server from mocks and their defects are found', async () => {
  const res = await run({ crawl: true, roles: ROLES });
  const paths = res.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/admin [role: admin]', '/dashboard [role: admin]', '/dashboard [role: viewer]', '/tasks [role: viewer]'], dump(res));
  assert.ok(on(res, 'plan', '/admin [role: admin]'), dump(res));
  assert.ok(on(res, 'span', '/tasks [role: viewer]'), dump(res)); // fetched with node:http on the server
  assert.ok(!res.issues.some((i) => /auth-required|page-error/.test(i.rule)), dump(res));
  // the page knows which server calls made it, mocked or not
  const tasks = res.pages.find((p) => p.path === '/tasks [role: viewer]');
  assert.ok(tasks.server.some((e) => e.url.endsWith('/api/tasks') && e.mocked), JSON.stringify(tasks.server));
});

test('a role that is sent elsewhere from a page it must see is reported, not checked in its place', async () => {
  const res = await run({ roles: { admin: { ...ROLES.admin, pages: ['/admin'] }, viewer: { ...ROLES.viewer, pages: ['/admin'] } } });
  const hit = res.issues.find((i) => i.rule === 'page-not-shown');
  assert.ok(hit && hit.severity === 'error' && hit.pages.join() === '/admin [role: viewer]', dump(res));
  assert.match(hit.message, /for role "viewer": the app redirected to \/403 \(role "admin" sees it\)\. It is in roles\.viewer\.pages/);
  assert.ok(!res.issues.some((i) => i.rule === 'auth-required'), dump(res));
  assert.ok(on(res, 'plan', '/admin [role: admin]'), dump(res));
});

test('an SSR page that fails because a server request is not mocked says which one', async () => {
  const res = await run({ pages: ['/billing'], roles: { admin: ROLES.admin } });
  const hit = res.issues.find((i) => i.rule === 'page-error');
  assert.ok(hit, dump(res));
  assert.match(hit.message, /HTTP 500\. The server's own requests failed: GET http:\/\/127\.0\.0\.1:4599\/api\/billing \(ECONNREFUSED\)/);
});

test('data stress reaches server-rendered data: the server gets longer JSON', async () => {
  const res = await run({ stress: 1, roles: { admin: ROLES.admin } });
  const hit = res.issues.find((i) => i.rule === 'fragile-layout' && i.details && i.details.profile === 'data' && /title/.test(i.selector));
  assert.ok(hit, dump(res));
});
