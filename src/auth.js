// Signed-in pages. renderlint either logs in once with real credentials, or (frontend only,
// no backend needed) sets the token or flags the app's route guards read. Either way the
// session (cookies, localStorage, sessionStorage, IndexedDB) is reused for every page and viewport.
//
//   auth: { login: '/login', user: '${RENDERLINT_USER}', password: '${RENDERLINT_PASSWORD}' }
//   auth: { login: { page, fill: { selector: value }, submit, waitFor }, … }
//   auth: { storage: { sessionStorage: { token: 'test' }, localStorage: {…}, cookies: [{ name, value }] } }
//   auth: { run: async (page, { baseUrl }) => { … } }      (JS config: SSO, MFA, anything else)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const USER_FIELD = 'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[id*="user" i], input[id*="email" i], input[type="text"]';
const PASSWORD_FIELD = 'input[type="password"]';
const SUBMIT = 'button[type="submit"], input[type="submit"], form button:not([type="button"]):not([type="reset"])';
const LOGIN_ERROR = '[role="alert"], .error, .alert, .invalid-feedback, mat-error, .mat-mdc-form-field-error, .p-message-error, .ant-form-item-explain-error';
export const LOGIN_PATH = /(^|[/#_-])(log-?in|sign-?in|signin|auth|sso|session\/new|account\/login)([/?#._-]|$)/i;

// "${NAME}" in auth values comes from the environment, so secrets stay out of the config file.
export function resolveEnv(value, where) {
  if (typeof value !== 'string') return value;
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => {
    if (process.env[name] === undefined) throw new Error(`renderlint: ${where} uses \${${name}}, but the environment variable ${name} is not set`);
    return process.env[name];
  });
}

export function normalizeAuth(auth) {
  if (auth === undefined || auth === null || auth === false) return null;
  if (typeof auth !== 'object') throw new Error('renderlint: "auth" must be an object: { login, user, password } or { storage } (see docs/authentication.md)');
  const out = { ...auth };
  if (typeof out.login === 'string') out.login = { page: out.login };
  if (out.login) {
    if (typeof out.login !== 'object' || !out.login.page) throw new Error('renderlint: "auth.login" must be a path such as "/login" or { page, fill, submit, waitFor }');
    if (!out.login.fill && !(out.user && out.password)) throw new Error('renderlint: "auth.login" needs "user" and "password" (e.g. "${RENDERLINT_USER}"), or "fill": { selector: value }');
  }
  if (out.storage && typeof out.storage !== 'object') throw new Error('renderlint: "auth.storage" must be { localStorage, sessionStorage, cookies }');
  if (!out.login && !out.storage && typeof out.run !== 'function') throw new Error('renderlint: "auth" needs "login", "storage" or (JS config) "run"');
  return out;
}

// Sets sessionStorage before the app's scripts run (Playwright's storageState has no sessionStorage).
// Only for the origin it belongs to, and only keys the app hasn't set itself in this tab.
export function sessionStorageScript(byOrigin) {
  return `(() => { try {
    const all = ${JSON.stringify(byOrigin)}, items = all[location.origin];
    if (!items) return;
    for (const [k, v] of Object.entries(items)) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
  } catch {} })();`;
}

// Log in (or apply the given storage) once; returns { storageState, sessionStorage, initScript }.
export async function authenticate(browser, baseUrl, config, { log = () => {}, routePage } = {}) {
  const auth = config.auth;
  const origin = new URL(baseUrl).origin;
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, bypassCSP: true, ...(config.contextOptions || {}) });
  try {
    const page = await context.newPage();
    if (routePage) await routePage(page);
    const storage = auth.storage || {};
    const cookies = (storage.cookies || []).map((c) => ({ path: '/', ...c, value: resolveEnv(String(c.value), 'auth.storage.cookies'), ...(c.domain ? {} : { url: origin }) }));
    if (cookies.length) await context.addCookies(cookies.map((c) => (c.url ? (({ path, ...rest }) => rest)(c) : c)));
    const local = Object.fromEntries(Object.entries(storage.localStorage || {}).map(([k, v]) => [k, resolveEnv(typeof v === 'string' ? v : JSON.stringify(v), 'auth.storage.localStorage')]));
    const session = Object.fromEntries(Object.entries(storage.sessionStorage || {}).map(([k, v]) => [k, resolveEnv(typeof v === 'string' ? v : JSON.stringify(v), 'auth.storage.sessionStorage')]));
    if (Object.keys(local).length || Object.keys(session).length) {
      await context.addInitScript(({ local, session }) => {
        try {
          for (const [k, v] of Object.entries(local)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
          for (const [k, v] of Object.entries(session)) if (sessionStorage.getItem(k) === null) sessionStorage.setItem(k, v);
        } catch { /* storage disabled */ }
      }, { local, session });
    }

    if (auth.login) {
      const l = auth.login;
      const loginUrl = new URL(l.page, baseUrl).href;
      log(`Logging in at ${new URL(loginUrl).pathname}…`);
      await page.goto(loginUrl, { waitUntil: 'load', timeout: config.timeout });
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
      const fill = l.fill
        ? Object.entries(l.fill).map(([sel, v]) => [sel, resolveEnv(String(v), 'auth.login.fill')])
        : [[USER_FIELD, resolveEnv(String(auth.user), 'auth.user')], [PASSWORD_FIELD, resolveEnv(String(auth.password), 'auth.password')]];
      for (const [sel, value] of fill) {
        const field = page.locator(sel).filter({ visible: true }).first();
        await field.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { throw new Error(`renderlint: login form field not found: ${sel === USER_FIELD ? 'user name/email' : sel === PASSWORD_FIELD ? 'password' : sel} on ${new URL(loginUrl).pathname}. Set "auth.login.fill": { "<selector>": "<value>" }.`); });
        await field.fill(value);
      }
      const before = page.url();
      const submit = page.locator(l.submit || SUBMIT).filter({ visible: true }).first();
      if (await submit.count()) await submit.click(); else await page.locator(PASSWORD_FIELD).first().press('Enter');
      // Done when the given selector/URL shows up, or (by default) when we've left the login page.
      // An error message on the form ends the wait early ("Wrong password" won't go away by waiting).
      const done = l.waitFor && /^(\/|https?:)/.test(l.waitFor) ? page.waitForURL(new URL(l.waitFor, baseUrl).href.includes('*') ? l.waitFor : (u) => u.href.startsWith(new URL(l.waitFor, baseUrl).href), { timeout: config.timeout })
        : l.waitFor ? page.waitForSelector(l.waitFor, { timeout: config.timeout })
        : page.waitForURL((u) => u.href !== before && !LOGIN_PATH.test(u.pathname + u.hash), { timeout: config.timeout });
      const error = page.locator(LOGIN_ERROR).filter({ hasText: /invalid|incorrect|wrong|fail|error|not (found|recogni[sz]ed|match)|denied|locked|try again|required/i, visible: true }).first();
      const rejected = error.waitFor({ state: 'visible', timeout: config.timeout }).then(async () => {
        await page.waitForTimeout(1500);
        if (page.url() === before && await error.isVisible()) throw new Error('rejected');
        return done;
      });
      done.catch(() => {}); rejected.catch(() => {});
      try {
        await Promise.race([done, rejected]);
      } catch {
        const shot = join(config.outputDir, 'screens', 'login-failed.png');
        mkdirSync(join(config.outputDir, 'screens'), { recursive: true });
        await page.screenshot({ path: shot }).catch(() => {});
        const msg = await page.locator(LOGIN_ERROR).filter({ visible: true }).allInnerTexts().catch(() => []);
        throw new Error(`renderlint: login didn't complete: still on ${new URL(page.url()).pathname + new URL(page.url()).hash} ${l.waitFor ? `(waiting for ${l.waitFor})` : ''} after submitting the form.` +
          (msg.join(' ').trim() ? ` The page says: "${msg.join(' ').trim().slice(0, 200)}".` : '') + ` Check the credentials and "auth.login" selectors; screenshot: ${shot}`);
      }
      await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    }
    if (typeof auth.run === 'function') {
      if (!auth.login) await page.goto(baseUrl, { waitUntil: 'load', timeout: config.timeout });
      await auth.run(page, { baseUrl });
    }

    // What the app stored in this tab: Playwright's storageState doesn't include sessionStorage.
    const sessionByOrigin = {};
    for (const f of page.frames()) {
      try {
        const o = new URL(f.url()).origin;
        if (!/^https?:/.test(o)) continue;
        const items = await f.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)])));
        if (Object.keys(items).length) sessionByOrigin[o] = { ...(sessionByOrigin[o] || {}), ...items };
      } catch { /* cross-origin or detached frame */ }
    }
    if (Object.keys(session).length) sessionByOrigin[origin] = { ...session, ...(sessionByOrigin[origin] || {}) };
    let storageState;
    try { storageState = await context.storageState({ indexedDB: true }); } catch { storageState = await context.storageState(); }
    for (const o of storageState.origins) if (o.origin === origin) for (const [k, v] of Object.entries(local)) if (!o.localStorage.some((x) => x.name === k)) o.localStorage.push({ name: k, value: v });
    if (Object.keys(local).length && !storageState.origins.some((o) => o.origin === origin)) storageState.origins.push({ origin, localStorage: Object.entries(local).map(([name, value]) => ({ name, value })) });
    const n = storageState.cookies.length + storageState.origins.reduce((s, o) => s + o.localStorage.length + ((o.indexedDB || []).length), 0) + Object.values(sessionByOrigin).reduce((s, o) => s + Object.keys(o).length, 0);
    log(`Signed in: reusing ${n} stored item(s) (cookies, localStorage, sessionStorage, IndexedDB) for every page.`);
    return { storageState, sessionStorage: sessionByOrigin, initScript: Object.keys(sessionByOrigin).length ? sessionStorageScript(sessionByOrigin) : null };
  } finally {
    await context.close().catch(() => {});
  }
}

// Did the app send us to a login page (or an identity provider) instead of the page we asked for?
export function loginRedirect(requested, landed, hasPasswordField) {
  let a, b;
  try { a = new URL(requested); b = new URL(landed); } catch { return null; }
  const route = (u) => u.pathname + (u.hash.startsWith('#/') || u.hash.startsWith('#!/') ? u.hash : '');
  if (LOGIN_PATH.test(route(a))) return null; // we asked for the login page
  if (a.origin !== b.origin) {
    // www./https upgrades are the same site; another host is an identity provider only if it looks like one
    const site = (u) => u.hostname.replace(/^www\./, '');
    if (site(a) !== site(b)) return LOGIN_PATH.test(b.pathname) || /oauth|authorize|openid|saml|realms\/|\/adfs\//i.test(b.pathname + b.search) || hasPasswordField ? { to: b.origin + b.pathname, external: true } : null;
  }
  if (route(a).replace(/\/$/, '') === route(b).replace(/\/$/, '')) return null;
  if (LOGIN_PATH.test(route(b)) || hasPasswordField) return { to: route(b) + (b.search && !/[?&](returnUrl|redirect|next|returnTo)=/.test(b.search) ? b.search : ''), external: false };
  return null;
}
