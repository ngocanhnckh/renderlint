// Drives a headless browser over pages × viewports × color schemes and
// collects issues from the in-page analyzer plus screenshot-based checks.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzerSource } from './analyzer/bundle.js';
import { measureContrast } from './contrast.js';
import { measureDropdowns, checkMenus } from './controls.js';
import { dialogAdvice, RULES } from './rules-meta.js';
import { stressJson } from './stress-data.js';
import { authenticate, loginRedirect, LOGIN_PATH } from './auth.js';
import { loadMockSources, answerFrom } from './mock-sources.js';
import { ROLE_COOKIE, RUN_COOKIE, STRESS_COOKIE, STATE_COOKIE } from './server-plan.js';
import { DISCOVER_ROUTES, NG_ROUTES_HOOK, NOT_SHOWN_SCRIPT, fillParams, isDynamic, notShownFindings, pagePatterns, patternRegex, redirectedTo, routeOf } from './routes/runtime.js';
import { randomUUID } from 'node:crypto';

export const SETTLE_SCRIPT = async ({ autoScroll }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = [performance.now()]; const mark = () => T.push(Math.round(performance.now() - T[0]));
  // Never mutate <html>/<body> attributes here: frameworks may still be hydrating.
  if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(3000)]);
  mark();
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
  // Counters that count up when scrolled into view (Elementor, countUp.js…): note when numbers last changed.
  let lastCount = 0;
  const mo = new MutationObserver((ms) => { for (const m of ms) if (/\d/.test(m.target.textContent || '')) { lastCount = performance.now(); break; } });
  if (document.body) mo.observe(document.body, { characterData: true, childList: true, subtree: true });
  if (autoScroll) {
    // Trigger lazy-loading and scroll-reveal animations, then return to the top.
    const step = Math.max(300, innerHeight);
    for (let y = 0, i = 0; y < document.documentElement.scrollHeight && i < 30; y += step, i++) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  mark();
  await sleep(150);
  const imgs = Array.from(document.images).filter((i) => !i.complete);
  await Promise.race([Promise.all(imgs.map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }))), sleep(4000)]);
  mark();
  // Jump finite animations/transitions to their end state; pause infinite ones.
  for (const a of document.getAnimations ? document.getAnimations() : []) {
    try {
      const end = a.effect && a.effect.getComputedTiming().endTime;
      if (end !== undefined && isFinite(end)) a.finish(); else a.pause();
    } catch { /* ignore */ }
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Let running counters reach their final value (up to 3s).
  for (const t = performance.now(); lastCount && performance.now() - lastCount < 400 && performance.now() - t < 3000;) await sleep(100);
  mo.disconnect();
  mark();
  return T.slice(1);
};

// Hash-based routes (Angular withHashLocation, Vue/React hash routers: /#/accounts) are pages of their own.
export const hashRoute = (u) => (/^#!?\//.test(u.hash) ? u.hash : '');

// Installed in every frame before the page's own scripts: tracks pending setTimeout
// timers, so a wait can end once nothing is scheduled, and provides __rlWaitQuiet(),
// which resolves after `frames` frames in a row with no DOM mutation, no font loading and
// no timer due before the deadline, or at the deadline (maxMs) whatever happens.
export const READY_INIT = () => {
  if (window.__rlWaitQuiet) return;
  const set = window.setTimeout, clear = window.clearTimeout, clearI = window.clearInterval;
  const pending = new Map(); // timer id -> due time
  const same = (f, native) => { try { Object.defineProperty(f, 'toString', { value: () => native.toString(), configurable: true, writable: true }); } catch (e) { /* ignore */ } return f; };
  window.setTimeout = same(function setTimeout(fn, ms, ...args) {
    if (typeof fn !== 'function') return set.apply(window, arguments);
    const id = set.call(window, function () { pending.delete(id); return fn.apply(this, arguments); }, ms, ...args);
    pending.set(id, performance.now() + (Number(ms) || 0));
    return id;
  }, set);
  window.clearTimeout = same(function clearTimeout(id) { pending.delete(id); return clear.call(window, id); }, clear);
  window.clearInterval = same(function clearInterval(id) { pending.delete(id); return clearI.call(window, id); }, clearI);
  window.__rlWaitQuiet = (maxMs, frames) => new Promise((resolve) => {
    const t0 = performance.now(), deadline = t0 + maxMs;
    let quiet = 0, done = false;
    const mo = new MutationObserver(() => { quiet = -1; });
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const finish = () => { if (done) return; done = true; mo.disconnect(); resolve(Math.round(performance.now() - t0)); };
    set.call(window, finish, maxMs);
    const tick = () => {
      if (done) return;
      quiet++;
      let busy = document.fonts && document.fonts.status === 'loading';
      if (!busy) for (const due of pending.values()) if (due <= deadline) { busy = true; break; }
      if (quiet >= frames && !busy) finish(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};

// Waits until the page is ready, instead of networkidle's fixed 500ms: no request in
// flight (one open for over 2s is a long-poll or a stream and doesn't count) and none for
// 100ms, then __rlWaitQuiet() in the page (timers due within 500ms, DOM changes, fonts);
// again if the page made requests meanwhile. At most maxMs.
export async function waitReady(page, net, maxMs) {
  const end = Date.now() + maxMs;
  const busy = () => { const now = Date.now(); for (const t of net.inflight.values()) if (now - t < 2000) return true; return now - net.last < 100; };
  while (Date.now() < end) {
    while (busy() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    const mark = net.count, left = end - Date.now();
    if (left <= 0) return;
    const ok = await page.evaluate((ms) => (window.__rlWaitQuiet ? window.__rlWaitQuiet(ms, 3) : null), Math.min(left, 500)).catch(() => null);
    if (ok === null) { await page.waitForLoadState('networkidle', { timeout: Math.max(1, end - Date.now()) }).catch(() => {}); return; }
    if (net.count === mark && !busy()) return;
  }
}

export function trackNetwork(page) {
  const net = { inflight: new Map(), last: Date.now(), count: 0 };
  page.on('request', (r) => { if (/^(eventsource|websocket)$/.test(r.resourceType())) return; net.inflight.set(r, Date.now()); net.count++; net.last = Date.now(); });
  const done = (r) => { if (net.inflight.delete(r)) net.last = Date.now(); };
  page.on('requestfinished', done); page.on('requestfailed', done);
  return net;
}

// Writes a PNG screenshot of clip (page coordinates, beyond the viewport if needed) through
// CDP with optimizeForSpeed: about a third cheaper to encode than Playwright's screenshot().
// Prepares the page as screenshot({ animations: 'disabled', caret: 'hide' }) does.
export async function writeShot(page, path, clip) {
  let cdp;
  try {
    cdp = await page.context().newCDPSession(page);
    const touch = await page.evaluate(() => {
      // as Playwright does: finish finite animations, cancel infinite ones (played again after),
      // also those that start during the capture
      const resume = new Set();
      const handle = () => {
        for (const a of document.getAnimations ? document.getAnimations() : []) {
          if (!a.effect || a.playbackRate === 0 || resume.has(a)) continue;
          try { if (Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); else { a.cancel(); resume.add(a); } } catch (e) { /* ignore */ }
        }
      };
      handle();
      document.addEventListener('transitionrun', handle); document.addEventListener('animationstart', handle);
      const st = document.createElement('style');
      st.textContent = '*:not(#__renderlint_overlay){caret-color:transparent !important}';
      document.documentElement.appendChild(st);
      window.__rlShotCleanup = () => {
        document.removeEventListener('transitionrun', handle); document.removeEventListener('animationstart', handle);
        st.remove();
        for (const a of resume) { try { a.play(); } catch (e) { /* ignore */ } }
      };
      return navigator.maxTouchPoints > 0;
    });
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true, optimizeForSpeed: true });
      writeFileSync(path, Buffer.from(data, 'base64'));
    } finally {
      // capturing beyond the viewport resets touch emulation (Playwright re-enables it too)
      if (touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true }).catch(() => {});
      await page.evaluate(() => window.__rlShotCleanup && window.__rlShotCleanup()).catch(() => {});
    }
  } catch {
    await page.screenshot({ path, clip, fullPage: true, animations: 'disabled', caret: 'hide' });
  } finally {
    if (cdp) await cdp.detach().catch(() => {});
  }
}


// What a page renders, as a hash: the DOM with its text and form values (open shadow roots too), every
// element's box, the canvases' pixels and the resources it loaded (relative URLs resolve per page, so they are
// part of it). Two pages with the same fingerprint lay out the same at every width. null: not comparable.
// With `template`, also the page's skeleton: tags and classes, without text, runs of alike siblings counted once.
const FINGERPRINT_SCRIPT = ({ template }) => {
  const parts = [innerWidth, innerHeight, scrollX, scrollY, document.documentElement.scrollWidth, document.documentElement.scrollHeight, document.documentElement.outerHTML];
  const res = performance.getEntriesByType('resource');
  if (res.length >= 5000) return null; // the buffer filled up: the list is incomplete
  // (the browser fetches /favicon.ico on its own, sometimes after the check started)
  parts.push(Array.from(new Set(res.map((e) => e.name).filter((n) => !/\/favicon\.ico(\?|$)/.test(n)))).sort().join(' '));
  let canvases = 0;
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      parts.push(`${r.x},${r.y},${r.width},${r.height}`);
      if ('value' in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) parts.push(el.value, el.checked);
      if (el.tagName === 'CANVAS') {
        if (++canvases > 20) throw new Error('too many canvases');
        parts.push(el.toDataURL()); // throws when tainted: not comparable
      }
      if (el.shadowRoot) { parts.push(el.shadowRoot.innerHTML); walk(el.shadowRoot); }
    }
  };
  const hash = (all, seed) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < all.length; i++) { const c = all.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
  };
  const id = (s) => s.length + ':' + hash(s, 1) + hash(s, 2);
  const shape = (el) => {
    const kids = [];
    for (const c of el.children) { const k = shape(c); if (kids[kids.length - 1] !== k) kids.push(k); }
    return el.tagName + (el.classList.length ? '.' + Array.from(el.classList).sort().join('.') : '') + (kids.length ? '[' + kids.join(',') + ']' : '');
  };
  let fp = null;
  try { walk(document); fp = id(parts.join('\n')); } catch { /* not comparable */ }
  return { fp, skeleton: template && document.body ? id(shape(document.body)) : null };
};

export function slugFor(url, role) {
  const u = new URL(url);
  const s = (u.pathname.replace(/\/+$/, '') || '/index').replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
  const extra = u.search + hashRoute(u);
  const name = (s + (extra ? '-' + extra.replace(/[^a-z0-9]+/gi, '-') : '')).slice(0, 60);
  let h = 0;
  for (const ch of u.pathname + extra) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return name + '-' + h.toString(36).slice(0, 5) + (role ? '-' + role.replace(/[^a-z0-9]+/gi, '-') : '');
}

const NAV_SKIP = /\.(pdf|zip|png|jpe?g|gif|svg|webp|avif|mp4|webm|mp3|xml|txt|json|css|js|ico|woff2?)(\?|#|$)/i;
// Following a log-out link would end the session every other page is checked with.
const LOGOUT = /(^|[/#_-])(log-?out|sign-?out|signoff|logoff|end-?session)([/?#._-]|$)/i;
// WordPress: admin, login, feeds, REST and links with side effects (log out, add to cart) are never crawled.
const WP_SKIP = /^\/(wp-admin|wp-login\.php|wp-json|wp-content|wp-includes|xmlrpc\.php|wp-cron\.php|wp-signup\.php|wp-activate\.php)\b|\/(feed|trackback|embed)\/?$|\/comments\/feed|\/customer-logout\b/;
const WP_SKIP_QUERY = /[?&](replytocom|feed|rest_route|add-to-cart|add_to_wishlist|remove_item|undo_item|action|share|preview|_wpnonce|wc-ajax|elementor-preview|ver)=/;
// Posts, archives and pagination share templates: two of each kind are enough.
function wpGroup(u) {
  if (/\/page\/\d+\/?$|[?&]paged=/.test(u.pathname + u.search)) return 'paged';
  const m = /^\/(category|tag|author|product-category|product-tag)\//.exec(u.pathname) || /[?&](cat|tag|author|m)=/.exec(u.search);
  if (m) return 'archive:' + m[1];
  if (/^\/\d{4}\/\d{2}\//.test(u.pathname) || /^\/\d{4}\/\d{2}\/?$/.test(u.pathname)) return 'dated';
  if (/[?&]p=\d+/.test(u.search) || /^\/(blog|news|product|products|shop)\/[^/]+\/?$/.test(u.pathname)) return 'single:' + (u.pathname.split('/')[1] || 'p');
  return null;
}

// A link that may change data when opened (GET /items/3/delete, /unsubscribe?t=…, ?action=remove) is never
// followed by the crawl: only pages you list are opened. Whole path segments and query keys/values only, so
// /blog/how-to-remove-stains is still checked.
const DESTRUCTIVE_WORDS = 'delete|remove|destroy|cancel|unsubscribe|deactivate|reset|revoke|purge|wipe|terminate|erase';
const DESTRUCTIVE = new RegExp(`(^|/)(${DESTRUCTIVE_WORDS})([-_.][^/?#]*)?(/|$)|[-_](${DESTRUCTIVE_WORDS})(/|$)|[?&](${DESTRUCTIVE_WORDS})([=&]|$)|[?&][\\w.-]*=(${DESTRUCTIVE_WORDS})(&|$)`, 'i');
export function looksDestructive(href) {
  let u; try { u = new URL(href); } catch { return false; }
  return DESTRUCTIVE.test(u.pathname + hashRoute(u).replace(/^#/, '').replace(/\?/, '&')) || DESTRUCTIVE.test(u.search);
}

// session: an existing signed-in state ({ storageState, initScript }) instead of config.auth, e.g. a test's.
// replay: the pages are re-opened from a test's state: one that lands elsewhere is skipped, not checked.
export async function runChecks(browser, { urls, config, log = () => {}, session: given = null, replay = false, serverLog = null, coverage = null }) {
  const allViewports = config.viewports;
  const outDir = config.outputDir;
  if (config.screenshots) mkdirSync(join(outDir, 'screens'), { recursive: true });
  const source = analyzerSource();
  const ignoreSelectors = {};
  for (const ig of config.ignore || []) {
    if (!ig.selector) continue;
    const r = ig.rule || '*';
    (ignoreSelectors[r] = ignoreSelectors[r] || []).push(ig.selector);
  }
  const analyzeOpts = {
    rules: config.rules, ignoreSelectors, skipDomContrast: true, contrastCandidates: config.rules.contrast !== 'off', // collected separately after re-settling
    minTapTarget: config.minTapTarget, minFontSize: config.minFontSize, maxLineLength: config.maxLineLength,
  };

  // API responses from the project's MSW handlers or a HAR recording ("mockFrom"), loaded once
  const sources = await loadMockSources(config.mockFrom);
  if (sources.length) log(`Answering API requests from ${sources.map((x) => x.kind === 'har' ? 'the HAR ' + x.file : 'the MSW handlers in ' + x.file).join(' and ')}`);
  // Roles: every page is checked as each role (its own session and mocks), all roles at once. Without "roles", one unnamed role.
  const multi = !!(config.roles && Object.keys(config.roles).length);
  const roles = multi ? Object.entries(config.roles).map(([name, r]) => ({ name, auth: r.auth, mock: r.mock, pages: r.pages || [], deny: r.deny || [] })) : [{ name: null, auth: config.auth, mock: null, pages: [], deny: [] }];
  // Signed in: tell the pages the app didn't show (a guard's redirect, 401/403, "Access denied") from checked ones.
  const detect = (multi || !!config.auth || !!given) && !replay && config.rules['page-not-shown'] !== 'off';
  // The route table read from the app's router at runtime: when its source named no routes.
  // The route table read from the app's router at runtime, too: it catches routes the source scan missed (route coverage decides how many of each are checked).
  const discover = config.crawl && config.routes !== false;
  const listed = new Set(urls.map(normalizeUrl)); // pages asked for, as opposed to found by crawling
  const origin = new URL(urls[0]).origin;
  const pages = [];
  const routeKeys = new Set(); // URLs that are rendered routes of the app
  const outcomes = new Map(); // page key → { url, route, source, page, roles: { role: null (shown) | why not } }
  const jsonSeen = []; // JSON the app received (mocked or real): values for dynamic route parameters
  const mockData = [config.mock, ...roles.map((r) => r.mock)].filter(Boolean).flatMap((m) => Object.entries(m)).map(([pattern, v]) => ({ url: pattern, json: mockJson(v) })).filter((d) => d.json !== undefined);
  const roleCoverage = { roles: roles.map((r) => r.name).filter(Boolean), framework: null, skipped: [], overLimit: null };
  const unsafe = new Set();
  const destructive = (href) => {
    if (!looksDestructive(href)) return false;
    const p = pathOf(href, origin);
    if (!unsafe.has(p)) { unsafe.add(p); log(`  not opened: ${p} (looks like it changes data; list it in "pages" to check it)`); roleCoverage.skipped.push({ route: p, reason: 'looks like it changes data (delete, cancel, reset…): only listed pages are opened' }); }
    return true;
  };

  // Every page × color scheme × viewport is one browser context; `concurrency` of them run at once, across
  // pages and roles: the next page starts as soon as its URL is known, while earlier pages are still in their slower passes.
  // Links are taken from each page's first analysis, in the same order as a page-by-page crawl, so the same pages are checked.
  const slot = limiter(config.concurrency || 3);
  const reps = config.dedupe === false ? null : new Map(); // rendering fingerprint → the run whose later passes are shared
  let darkSeen = false;
  const cssCache = new Map(); // cross-origin stylesheet → can it depend on the color scheme?
  // Findings already marked on a written screenshot. The report points each finding to its
  // first screenshot, so a later one is written only when it marks something new.
  const marked = new Set();

  // Route coverage: the app's routes (from its source, sitemap and build output) seed the queue, and crawled
  // links and API lists add instances of dynamic routes, a few per route. Its choices hold for every role.
  const seeds = coverage ? coverage.seeds() : [];
  // an instance with a value from "params": a missing page there may mean a wrong value
  const paramPatterns = Object.keys(config.params || {}).filter((p) => p.startsWith('/')).map(patternRegex);
  const fromParams = (u) => paramPatterns.some((re) => re.test(routeOf(u)));
  const said = new Map();
  const coverageSays = (href) => { const key = normalizeUrl(href); if (!said.has(key)) said.set(key, coverage.onLink(href)); return said.get(key); };
  const planned = []; // URLs route coverage chose after the start (API lists, variety picks): every role checks them
  const onJson = coverage || discover ? (apiUrl, body) => {
    if (discover && jsonSeen.length < 200) jsonSeen.push({ url: apiUrl, json: body });
    if (coverage) planned.push(...coverage.onJson(apiUrl, body));
  } : null;

  const runRole = async (r) => {
    const rconfig = multi ? { ...config, auth: r.auth, mock: mergeMocks(config.mock, r.mock), role: { name: r.name, pages: r.pages } } : config;
    // Signed-in pages: log in (or set the storage the app's guards read) once, reuse the session everywhere.
    let session = given;
    if (!session && rconfig.auth) {
      const mock = rconfig.mock || {};
      session = await authenticate(browser, urls[0], rconfig, { log: r.name ? (m) => log(`[${r.name}] ${m}`) : log, routePage: Object.keys(mock).length || sources.length ? (p) => p.route('**/*', (rt) => handleRoute(rt, { mock, sources, stressData: false })) : null });
    }
    const roleLabel = r.name ? ` [role: ${r.name}]` : '';
    const own = new Set(r.pages.map((p) => normalizeUrl(new URL(p, urls[0]).href))); // pages this role must be able to see
    const queue = [];
    const visited = new Set();
    const sourceOf = new Map();
    const linkRoutes = new Set(); // routes of every same-origin link seen (values for dynamic parameters)
    const groups = new Map(); // WordPress: crawled pages per template kind
    let routesFound = null, dynamic = [], took = 0;
    const enqueue = (href, src, { page = false } = {}) => {
      const key = normalizeUrl(href);
      if (page) routeKeys.add(key);
      if (visited.has(key)) return false;
      visited.add(key); sourceOf.set(key, src);
      queue.push(href);
      return true;
    };
    const skipPath = (p) => LOGOUT.test(p) || (rconfig.auth && LOGIN_PATH.test(p)) || (config.exclude || []).some((x) => globMatch(x, p));
    // a route from the app's router: route coverage decides, as for a link (a few instances per route)
    const planOk = (href) => !coverage || visited.has(normalizeUrl(href)) || coverageSays(href) === 'check';
    for (const u of urls) enqueue(u, 'listed');
    for (const p of r.pages) enqueue(new URL(p, urls[0]).href, 'listed');
    for (const u of seeds) if (!skipPath(routeOf(u)) && !destructive(u)) enqueue(u, fromParams(u) ? 'params' : 'route', { page: true });
    // pages listed explicitly are all checked
    const maxPages = config.maxPages || (coverage && coverage.routes.length ? Math.max(12, queue.length + coverage.routes.length + 20) : Math.max(12, queue.length));
    // quick: route coverage's base check of the other instances of a route: narrowest viewport, light
    // scheme, no stress, sweep, data stress or focus pass (per-instance content defects show up here).
    const quickConfig = { ...rconfig, stress: false, stressData: false };
    // dedupe: "template": per viewport, each page's skeleton hash (in crawl order), so the representative is always the first page
    const skeletons = config.dedupe === 'template' ? allViewports.map(() => []) : null;
    const mine = []; // this role's pages
    let fullStarted = 0;
    const started = new Set(); // pages checked fully as this role

    const startPage = (url, state, quick = false) => {
      const key = normalizeUrl(url);
      const pageInfo = { url, path: ((rconfig.pageLabel && rconfig.pageLabel(url)) || pathOf(url, origin)) + roleLabel + (state ? ` [state: ${state.name}]` : ''), runs: [], ...(r.name ? { role: r.name } : {}), ...(quick ? { quick: true } : {}) };
      const k = mine.length;
      pages.push(pageInfo); mine.push(pageInfo);
      if (!state && !quick) { fullStarted++; started.add(key); }
      // quick: the narrowest viewport; coverage.quick: "ends" adds the widest (desktop-only parts of a page)
      const viewports = !quick ? allViewports : coverage && coverage.opts.quick === 'ends' && allViewports.length > 1 ? [allViewports[0], allViewports[allViewports.length - 1]] : allViewports.slice(0, 1);
      const config = quick ? quickConfig : rconfig;
      const decisions = viewports.map(() => deferred());
      if (skeletons && !state && !quick) skeletons.forEach((list) => { list[k] = deferred(); });
      const template = (vi, si) => (!skeletons || state || quick ? null : si > 0 ? { decision: decisions[vi] } : {
        decision: decisions[vi], publish: skeletons[vi][k].resolve,
        decide: async (h) => { for (let j = 0; j < k; j++) if (skeletons[vi][j] && await skeletons[vi][j].promise === h) return mine[j].path; return null; },
      });
      const schemes = quick ? ['light'] : config.colorSchemes === 'auto' ? (darkSeen && state ? ['light', 'dark'] : ['light']) : config.colorSchemes.slice();
      const metas = viewports.map(() => deferred()); // first scheme's analysis meta per viewport (null on error)
      const sigs = viewports.map(() => deferred()); // first scheme's layout signature per viewport
      const runs = [];
      const startScheme = (si) => {
        const scheme = schemes[si];
        const opts = (vp, vi, dedupe) => {
          const first = !state && si === 0 && vi === 0;
          return { vp, scheme, config, replay, sources, source, analyzeOpts, outDir, state, marked, session, serverLog, crawled: !state && !listed.has(key) && !own.has(key), sweep: state || quick || si > 0 ? [] : config.sweep, viewports, focus: first && !quick && config.rules['focus-indicator'] !== 'off', log, cssCache,
            menus: !state && !quick && !replay && si === 0 && config.menus !== false && config.rules['popup-obscured'] !== 'off',
            detect: detect && !state, discover: discover && first && !quick && !routesFound,
            onJson: first ? onJson : null, probe: first && !!coverage,
            // dark mode: the stress passes are skipped when the layout provably matches the first scheme's
            wantSig: si === 0 ? (m) => (config.colorSchemes === 'auto' ? m.darkModeCss : schemes.length > 1) : null,
            onSig: si === 0 ? sigs[vi].resolve : null, refSig: si > 0 ? sigs[vi].promise : null,
            reps: dedupe && reps && !state ? reps : null, template: template(vi, si),
            onMeta: si === 0 ? (m) => {
              metas[vi].resolve(m);
              // dark mode starts as soon as the first light run has seen dark-mode CSS
              if (!quick && config.colorSchemes === 'auto' && m.darkModeCss && !schemes.includes('dark')) { schemes.push('dark'); darkSeen = true; startScheme(schemes.length - 1); }
            } : null };
        };
        runs[si] = viewports.map((vp, vi) => slot(async () => {
          const t0 = Date.now();
          const res = await checkOne(browser, url, opts(vp, vi, true)).then((res) => {
            if (res.skipped) log(`  ${pageInfo.path} @${vp.width}px: not replayed, ${res.skipped}`);
            if (!state && si === 0) {
              // Without "auth", the sign-in page we were sent to is a page of its own: check it under its real name.
              if (res.landed && !config.auth) enqueue(res.landed, 'landed');
              // Sent elsewhere (a role guard, an ordinary redirect): the page we landed on is checked under its own name.
              else if (res.notShown && res.landed && !LOGIN_PATH.test(routeOf(res.landed)) && !LOGOUT.test(routeOf(res.landed))) enqueue(res.landed, 'landed');
              // What each viewport was shown. A role's outcome counts only when every viewport agrees: a flaky render is not a finding.
              if (!quick && (detect || res.notShown)) {
                const o = outcomes.get(key) || { url, route: routeOf(url), source: listed.has(key) ? 'listed' : sourceOf.get(key) === 'listed' ? 'role' : sourceOf.get(key) || 'link', page: false, roles: {}, seen: {}, listedFor: {} };
                if (own.has(key)) o.listedFor[r.name || ''] = true;
                if (!res.error) (o.seen[r.name || ''] = o.seen[r.name || ''] || []).push(res.notShown || null);
                outcomes.set(key, o);
                if (vi === 0) pageInfo.notShown = res.notShown || undefined;
              }
            }
            return res;
          }).finally(() => {
            // never leave the crawl or later pages waiting on a run that failed outright
            if (si > 0) return;
            metas[vi].resolve(null);
            sigs[vi].resolve(null); // no signature (error, stress off, shared): later schemes run their own stress passes
            if (skeletons && !state && !quick) { skeletons[vi][k].resolve(null); decisions[vi].resolve(null); }
          });
          log(`  ${pageInfo.path} @${vp.width}px ${scheme}: ${res.notShown ? 'not shown (' + (res.notShown.to ? 'redirected to ' + res.notShown.to : res.notShown.text) + ')' : res.issues.length + ' finding(s)'} in ${Date.now() - t0}ms${res.stressReused ? ' (+ stress findings of ' + schemes[0] + ': same layout)' : ''}${res.reuse ? ' (renders like ' + res.reuse.path + ': later passes shared)' : res.templateOf ? ' (same template as ' + res.templateOf + ': base checks only)' : ''}`);
          return { vp, res, ms: Date.now() - t0 };
        }).then(async (x) => {
          if (!x.res.reuse) return x;
          // The stress, sweep and data passes of an identical rendering found what they would find here.
          const shared = await x.res.reuse.rest;
          if (!shared || shared.error) return slot(async () => ({ vp, res: await checkOne(browser, url, opts(vp, vi, false)), ms: x.ms }));
          x.res.issues.push(...shared.issues.map(cloneIssue));
          return x;
        }));
        for (const x of runs[si]) x.catch(() => {}); // rethrown by pageInfo.done
      };
      for (let si = 0; si < schemes.length; si++) startScheme(si);
      pageInfo.done = (async () => {
        const results = [];
        for (let si = 0; si < schemes.length; si++) results.push(await Promise.all(runs[si])); // a scheme added meanwhile has started already
        if (coverage && !state) {
          const first = results[0][0].res, ns = first.notShown;
          pageInfo.status = { httpStatus: first.httpStatus, finalUrl: first.finalUrl, authRequired: first.landed && (!ns || ns.kind === 'login') ? first.landed : ns && ns.kind === 'login' ? ns.to : first.issues.some((i) => i.rule === 'auth-required') ? 'sign-in page' : null, denied: first.denied || (ns && ns.kind === 'denied' && !ns.status ? ns.text : null), error: first.error, features: first.features };
          if (first.resources) pageInfo.resources = first.resources;
          coverage.onResult(url, { ...pageInfo.status, quick });
        }
        const issues = [];
        for (let si = 0; si < schemes.length; si++) {
          const scheme = schemes[si];
          for (const [vi, { vp, res, ms }] of results[si].entries()) {
            // Same DOM, same layout, color-only CSS differences: the stress passes would find exactly what they found in the first scheme.
            if (res.stressReused) res.issues.push(...results[0][vi].res.issues.filter((i) => i.rule === 'fragile-layout' && !i.sweepWidth).map(cloneIssue));
            if (res.skipped) { pageInfo.skipped = res.skipped; continue; }
            pageInfo.runs.push({ viewport: vp.width, scheme, ms, issues: res.issues.length, screenshot: res.screenshot, error: res.error, ...(res.notShown ? { notShown: res.notShown } : {}), ...(res.reuse ? { sharedWith: res.reuse.path } : {}), ...(res.templateOf ? { templateOf: res.templateOf } : {}), ...(res.stressReused ? { stressReused: true } : {}) });
            for (const is of res.issues) issues.push({ ...is, page: pageInfo.path, url, viewport: is.sweepWidth || vp.width, scheme, screenshot: is.sweepWidth || is.ownShot ? is.screenshot : res.screenshot, ...(state ? { state: state.name } : {}), ...(r.name ? { role: r.name } : {}) });
            if (res.server && res.server.length && !pageInfo.server) pageInfo.server = res.server;
            if (res.error) issues.push({ rule: 'page-error', severity: 'error', message: 'renderlint could not load or analyze this page: ' + res.error, page: pageInfo.path, url, viewport: vp.width, scheme });
          }
        }
        return issues;
      })();
      pageInfo.done.catch(() => {});
      return metas;
    };

    const takeLinks = (meta) => {
      for (const link of meta.links) {
        let u;
        try { u = new URL(link); } catch { continue; }
        if (u.origin !== origin || NAV_SKIP.test(u.pathname) || LOGOUT.test(u.pathname + u.hash)) continue;
        if (rconfig.auth && LOGIN_PATH.test(u.pathname + hashRoute(u))) continue; // signed in: the login page only redirects
        u.hash = hashRoute(u);
        if (discover) linkRoutes.add(routeOf(u.href));
        const key = normalizeUrl(u.href);
        if (visited.has(key)) continue;
        if ((config.exclude || []).some((p) => globMatch(p, u.pathname))) continue;
        if (destructive(u.href)) { visited.add(key); continue; }
        // a few instances per route are checked fully; the others are counted, and quick-checked
        if (coverage && coverageSays(u.href) !== 'check') { visited.add(key); continue; }
        if (meta.platform && meta.platform.wordpress) {
          if (WP_SKIP.test(u.pathname) || WP_SKIP_QUERY.test(u.search)) continue;
          const g = wpGroup(u);
          if (g && (groups.set(g, (groups.get(g) || 0) + 1).get(g)) > 2) continue;
        }
        enqueue(u.href, 'link');
      }
    };
    // The app's own route table, when its source named none: pages no link points to (reached by a button, typed in, behind a role).
    const takeRouter = (found) => {
      routesFound = found;
      if (!roleCoverage.framework) roleCoverage.framework = found.framework;
      log(`  ${found.framework} router: ${found.routes.filter((x) => x.page).length} page route(s)${r.name ? ' (role ' + r.name + ')' : ''}`);
      for (const p of pagePatterns(found, { skip: skipPath })) {
        if (isDynamic(p)) { dynamic.push(p); continue; }
        if (!destructive(origin + found.prefix + p) && planOk(origin + found.prefix + p)) enqueue(origin + found.prefix + p, 'router', { page: true });
      }
      for (const x of found.routes) if (x.lazy && !x.page && !roleCoverage.skipped.some((s) => s.route === x.path)) roleCoverage.skipped.push({ route: x.path, reason: 'lazy-loaded children renderlint could not load' });
    };
    // Dynamic routes (/users/:id) once the pages that link to them or load their data have been checked.
    const expandDynamic = () => {
      if (!dynamic.length) return false;
      const todo = dynamic; dynamic = [];
      let added = false;
      for (const pattern of todo) {
        const x = fillParams(pattern, { params: config.params || {}, links: Array.from(linkRoutes), data: [...jsonSeen, ...mockData] });
        if (x.missing) { if (!roleCoverage.skipped.some((s) => s.route === pattern)) roleCoverage.skipped.push({ route: pattern, reason: `no value for ${x.missing.map((m) => ':' + m).join(', ')} (set "params")` }); continue; }
        for (const p of x.paths) if (!destructive(origin + routesFound.prefix + p) && planOk(origin + routesFound.prefix + p) && enqueue(origin + routesFound.prefix + p, 'params', { page: true })) added = true;
      }
      return added;
    };
    // what route coverage chose since: every role checks it too
    // (a variety pick gets the full check even when it was seen, or quick-checked, before)
    const pull = () => {
      for (; took < planned.length; took++) {
        const x = planned[took], u = typeof x === 'string' ? x : x.url, key = normalizeUrl(u);
        if (destructive(u)) continue;
        if (!x.full) enqueue(u, 'route', { page: true });
        else if (!started.has(key) && !queue.some((q) => normalizeUrl(q) === key)) { visited.add(key); routeKeys.add(key); sourceOf.set(key, 'route'); queue.push(u); }
      }
    };

    const room = () => queue.length && fullStarted < maxPages;
    const metasOf = [];
    let k = 0;
    // Checks the queue and every page found from it (pages start as soon as their URL is known).
    const drain = async () => {
      for (;;) {
        pull();
        while (room()) metasOf.push(startPage(queue.shift(), null));
        if (k >= metasOf.length) {
          if (expandDynamic()) continue;
          break;
        }
        for (const d of metasOf[k++]) {
          const meta = await d.promise;
          if (!config.crawl || !meta) continue;
          takeLinks(meta);
          if (meta.routes && !routesFound) takeRouter(meta.routes);
          pull();
          if (room()) metasOf.push(startPage(queue.shift(), null));
        }
      }
    };
    const quickCheck = async (list) => {
      for (const u of list) if (!skipPath(routeOf(u)) && !destructive(u)) metasOf.push(startPage(u, null, true));
      await drain();
    };
    const finish = () => {
      // found but over the page limit: counted, not silently dropped
      if (queue.length) { const o = roleCoverage.overLimit || (roleCoverage.overLimit = { maxPages, count: 0, routes: [] }); o.count += queue.length; for (const u of queue) if (o.routes.length < 8 && !o.routes.includes(routeOf(u))) o.routes.push(routeOf(u)); }
      // UI states: once every page's light-mode analysis is in (it decides whether they get dark mode too).
      for (const st of config.states || []) if (!st.role || st.role === r.name) startPage(st.page ? new URL(st.page, urls[0]).href : urls[0], st);
      return queue;
    };
    return { drain, quickCheck, finish, behind: () => took < planned.length };
  };

  const runners = await Promise.all(roles.map(runRole));
  await Promise.all(runners.map((x) => x.drain()));
  // a role's pages added URLs (API lists) after another role was done
  for (let round = 0; round < 5 && runners.some((x) => x.behind()); round++) await Promise.all(runners.map((x) => x.drain()));
  if (coverage && coverage.opts.quick) {
    // Route coverage, tiered: every other known instance of each route gets the quick check (their links
    // count too, as the first role), then the most different instances by what that measured get the full check, as every role.
    for (let round = 0; round < 10; round++) {
      const pending = coverage.pendingQuick();
      if (!pending.length) break;
      await runners[0].quickCheck(pending);
    }
    for (const p of pages) if (p.quick && p.done) await p.done.catch(() => {});
    planned.push(...coverage.varietyPicks().map((url) => ({ url, full: true })));
    await Promise.all(runners.map((x) => x.drain()));
  }
  const left = runners.flatMap((x) => x.finish());
  const allIssues = [];
  for (const p of pages) { allIssues.push(...await p.done); delete p.done; }
  if (coverage) coverage.unvisited = Array.from(new Set(left)); // over the page limit

  // Pages the app didn't show (a guard's redirect, 401/403, "Access denied" or "Page not found" in place), per role.
  if (detect) {
    const deny = Object.fromEntries(roles.map((r) => [r.name || '', r.deny]));
    const same = (a, b) => (a === null || b === null ? a === b : a.kind === b.kind && a.to === b.to && a.text === b.text);
    const list = Array.from(outcomes.entries()).map(([key, o]) => {
      for (const [r, seen] of Object.entries(o.seen)) o.roles[r] = seen.every((x) => same(x, seen[0])) ? seen[0] : { kind: 'unstable' };
      delete o.seen;
      return Object.assign(o, { page: routeKeys.has(key) });
    });
    for (const f of notShownFindings(list, { roles: roles.map((r) => r.name || ''), deny, multi })) {
      const p = pages.find((x) => normalizeUrl(x.url) === normalizeUrl(f.url) && (x.role || null) === (f.role || null) && !/\[state:/.test(x.path) && !x.quick);
      for (const vp of allViewports) allIssues.push({ ...f, page: p ? p.path : pathOf(f.url, origin), viewport: vp.width, scheme: 'light' });
    }
    roleCoverage.pages = list.map((o) => ({ route: o.route, url: o.url, source: o.source, roles: Object.fromEntries(Object.entries(o.roles).map(([r, why]) => [r || 'default', why === null ? 'checked' : why.kind === 'unstable' ? 'differs by viewport' : o.expected && o.expected[r] ? 'denied (expected)' : (why.kind === 'login' ? 'sent to ' + why.to : why.kind === 'redirect' ? '→ ' + why.to : why.text) + (o.reported && o.reported[r] ? '' : why.kind === 'redirect' ? ' (ordinary redirect)' : ' (not a finding)')])) }));
  }
  return { issues: allIssues, pages, roleCoverage };
}

// The JSON a mock serves (for dynamic route parameters), or undefined.
function mockJson(v) {
  try {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'file' in v) return /\.json$/i.test(v.file) ? JSON.parse(readFileSync(v.file, 'utf8')) : undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && ('status' in v || 'json' in v || 'body' in v)) return v.json;
    return v;
  } catch { return undefined; }
}

// Mock layers, the last one winning: its patterns come first, since the first matching pattern serves the request.
function mergeMocks(...layers) {
  const out = {};
  for (const m of layers.filter(Boolean).reverse()) for (const [k, v] of Object.entries(m)) if (!(k in out)) out[k] = v;
  return out;
}

// Both sides of each breakpoint the page uses (u = first width of the wider layout), within the
// sweep's range: a layout that only fits in the middle of its range breaks at an edge.
export function breakpointWidths(sweep, bps) {
  const lo = Math.min(...sweep), hi = Math.max(...sweep);
  const out = new Set(sweep);
  for (const u of bps) for (const w of [u - 1, u]) if (w >= lo && w <= hi) out.add(w);
  return Array.from(out).sort((a, b) => a - b);
}

// Spread sweep widths over the configured viewports: each runs in the context
// (touch, height) of the nearest tested width.
export function sweepAssignment(widths, viewports) {
  const tested = new Set(viewports.map((v) => v.width));
  const out = new Map();
  for (const w of widths || []) {
    if (tested.has(w)) continue;
    const near = viewports.reduce((a, b) => (Math.abs(b.width - w) < Math.abs(a.width - w) ? b : a));
    if (!out.has(near.width)) out.set(near.width, []);
    out.get(near.width).push(w);
  }
  return out;
}

// Findings that mergeIssues() groups together share this key.
export const groupKey = (i) => [i.rule, i.selector || i.message, i.related ? i.related.selector : '', i.file || '', i.line || ''].join('|');

const STRESSED_RULES = ['text-overflow', 'text-crowding', 'text-clipped', 'content-overflow', 'viewport-overflow', 'text-overlap', 'element-overlap'];

// Mocked responses (config.mock / state.mock) and data stress share one route handler.
async function handleRoute(route, routes) {
  const req = route.request();
  const spec = mockFor(req.url(), routes.mock);
  try {
    if (spec) {
      if (routes.answered) routes.answered.add(req);
      let body = spec.file ? readFileSync(spec.file, 'utf8') : spec.body !== undefined ? (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body)) : JSON.stringify(spec.json !== undefined ? spec.json : spec.data);
      const isJson = spec.file ? /\.json$/i.test(spec.file) : typeof spec.body !== 'string';
      if (routes.stressData && isJson) { try { body = JSON.stringify(stressJson(JSON.parse(body), routes.stressData)); } catch { /* not JSON */ } }
      return await route.fulfill({ status: spec.status || 200, headers: { 'content-type': isJson ? 'application/json' : 'text/plain', ...(spec.headers || {}) }, body });
    }
    if (routes.sources && routes.sources.length && /^(fetch|xhr|eventsource|other)$/.test(req.resourceType())) {
      const a = await answerFrom(routes.sources, req);
      if (a && a.abort) return await route.abort('failed');
      if (a) {
        if (routes.answered) routes.answered.add(req);
        let body = a.body;
        if (routes.stressData && /json/.test(a.headers['content-type'] || '') && !notStressed(req.url(), routes)) { try { body = JSON.stringify(stressJson(JSON.parse(String(body)), routes.stressData)); } catch { /* not JSON */ } }
        const headers = { ...a.headers };
        delete headers['content-length']; delete headers['content-encoding'];
        return await route.fulfill({ status: a.status, headers, body });
      }
    }
    if (!routes.stressData || !/^(fetch|xhr)$/.test(req.resourceType()) || notStressed(req.url(), routes)) return await route.fallback();
    const resp = await route.fetch();
    const headers = { ...resp.headers() };
    if (!/json/.test(headers['content-type'] || '')) return await route.fulfill({ response: resp });
    let data;
    try { data = await resp.json(); } catch { return await route.fulfill({ response: resp }); }
    delete headers['content-length']; delete headers['content-encoding'];
    return await route.fulfill({ response: resp, headers, body: JSON.stringify(stressJson(data, routes.stressData)) });
  } catch {
    try { await route.fallback(); } catch { /* already handled */ }
  }
}

// JSON that isn't the page's data (a tool's own index, e.g. Storybook's index.json): never stressed.
function notStressed(url, { stressDataExclude }) {
  return (stressDataExclude || []).some((p) => globMatch(p, url) || globMatch(p, new URL(url).pathname));
}

function mockFor(url, mock) {
  for (const [pattern, v] of Object.entries(mock || {})) {
    if (!globMatch(pattern, url) && !globMatch(pattern, new URL(url).pathname + new URL(url).search)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && ('file' in v || 'status' in v || 'json' in v || 'body' in v)) return v;
    return { data: v };
  }
  return null;
}

// UI states that don't render on load: open menus and dialogs, other tabs, filled forms.
async function applyState(page, state, info) {
  const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
  for (const sel of list(state.click)) await page.click(sel, { timeout: 5000 });
  for (const sel of list(state.hover)) await page.hover(sel, { timeout: 5000 });
  for (const [sel, value] of Object.entries(state.fill || {})) await page.fill(sel, String(value), { timeout: 5000 });
  for (const key of list(state.press)) await page.keyboard.press(key);
  if (typeof state.run === 'function') await state.run(page, info);
  if (state.waitFor) await page.waitForSelector(state.waitFor, { timeout: 5000 });
  await page.waitForTimeout(state.delay || 300);
  await page.evaluate(() => {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      try { const end = a.effect && a.effect.getComputedTiming().endTime; if (end !== undefined && isFinite(end)) a.finish(); else a.pause(); } catch { /* ignore */ }
    }
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

// In the stress pass, selectors ignored for fragile-layout apply to every stressed rule.
function ignoreSelectorsFor(sel) {
  const out = { ...sel };
  const extra = sel['fragile-layout'] || [];
  for (const r of STRESSED_RULES) out[r] = [...(out[r] || []), ...extra];
  return out;
}

// Runs at most n tasks at once, in the order they were queued.
export function limiter(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const [fn, resolve, reject] = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push([fn, resolve, reject]); next(); });
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Copies a finding for another run; its screenshot marker belongs to the run that found it.
const cloneIssue = (i) => { const c = JSON.parse(JSON.stringify(i)); if (!c.sweepWidth) delete c.marker; return c; };

// /about/, /about and /about/index.html are the same page.
export function normalizeUrl(u) { try { const x = new URL(u); x.hash = hashRoute(x).replace(/\/$/, ''); x.pathname = x.pathname.replace(/\/index\.html?$/, '/'); return x.href.replace(/\/$/, ''); } catch { return u; } }
function pathOf(url, origin) { const u = new URL(url); return u.origin === origin ? (u.pathname + u.search + hashRoute(u)) : url; }
export function globMatch(pattern, str) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(str);
}

// Wraps alert/confirm/prompt to log the caller's location just before the native dialog opens.
const DIALOG_TRACE = () => {
  if (window.__renderlint_dialogs) return;
  window.__renderlint_dialogs = true;
  const debug = console.debug.bind(console);
  for (const name of ['alert', 'confirm', 'prompt']) {
    const orig = window[name];
    if (typeof orig !== 'function') continue;
    window[name] = { [name](...args) {
      let at = '';
      try {
        const frames = String(new Error().stack || '').split('\n').slice(2);
        const f = frames.find((l) => /https?:\/\//.test(l)) || '';
        at = (/\((.*)\)\s*$/.exec(f) || /at (.*)$/.exec(f) || [, ''])[1].trim();
      } catch { /* no stack */ }
      debug('[renderlint:dialog] ' + at);
      return orig.apply(this, args);
    } }[name];
  }
};

// Records the media queries the page's JS asks about (useMediaQuery, matchMedia breakpoints) for the sweep.
const MQ_RECORDER = () => {
  const mm = window.matchMedia;
  if (typeof mm !== 'function' || window.__renderlint_mq) return;
  const seen = (window.__renderlint_mq = []);
  window.matchMedia = function matchMedia(q) { if (seen.length < 200 && !seen.includes(String(q))) seen.push(String(q)); return mm.call(window, q); };
};

async function checkOne(browser, url, { replay, sources = [], vp, scheme, config, source, analyzeOpts, outDir, state, marked = new Set(), sweep = [], viewports, focus, menus, log, session, serverLog, crawled, reps, onMeta, template, cssCache, wantSig, onSig, refSig, onJson, probe, detect, discover }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: scheme,
    reducedMotion: config.reducedMotion ? 'reduce' : 'no-preference', bypassCSP: true, ignoreHTTPSErrors: true,
    hasTouch: vp.width < 1024, isMobile: false, ...(config.contextOptions || {}),
    ...(session ? { storageState: session.storageState } : {}),
  });
  await context.addInitScript(READY_INIT);
  // Server-side mocks: which role, UI state and run each page request is for (the preload reads these cookies).
  const run = serverLog || config.role ? randomUUID() : null;
  if (run) {
    const at = new URL(url).origin;
    await context.addCookies([[RUN_COOKIE, run], config.role && [ROLE_COOKIE, config.role.name], state && Object.keys(state.mock || {}).length && [STATE_COOKIE, state.name]]
      .filter(Boolean).map(([name, value]) => ({ name, value: encodeURIComponent(value), url: at })));
  }
  if (config.rules['native-dialog'] !== 'off') await context.addInitScript(DIALOG_TRACE);
  if (discover) await context.addInitScript(NG_ROUTES_HOOK);
  if (session && session.initScript) await context.addInitScript(session.initScript);
  const page = await context.newPage();
  const net = trackNetwork(page);
  const bpSweep = sweep.length && config.sweepBreakpoints;
  if (bpSweep) await page.addInitScript(MQ_RECORDER);
  if (reps) await page.addInitScript(() => { try { performance.setResourceTimingBufferSize(5000); } catch { /* old browser */ } });
  const issues = [];
  const origin = new URL(url).origin;
  // Console errors and failed requests count only in the main pass, not while data is stressed.
  let phase = 'main', sawJson = false;
  const routes = { mock: mergeMocks(config.mock, state && state.mock), sources, stressData: false, stressDataExclude: config.stressDataExclude, answered: new WeakSet() };
  let routed = false;
  const ensureRoutes = async () => { if (!routed) { routed = true; await page.route('**/*', (route) => handleRoute(route, routes)); } };
  if (Object.keys(routes.mock).length || sources.length) await ensureRoutes(); // interception disables the HTTP cache, so only when needed
  const consoleSeen = new Set();
  page.on('pageerror', (err) => {
    if (config.rules['console-error'] === 'off' || phase !== 'main') return;
    const msg = String(err && err.message || err).split('\n')[0].slice(0, 300);
    if (consoleSeen.has(msg)) return;
    consoleSeen.add(msg);
    issues.push({ rule: 'console-error', severity: 'error', message: 'Uncaught error: ' + msg, details: { stack: String(err && err.stack || '').split('\n').slice(0, 6).join('\n') } });
  });
  // alert(), confirm() and prompt(): a native browser dialog in place of the app's own UI. The wrapper
  // (DIALOG_TRACE) logs where it was called just before the dialog opens; confirm and prompt are answered
  // "Cancel", so checking never goes ahead with what they guard (a delete, discarding a form).
  let dialogAt = null;
  const dialogsSeen = new Set();
  if (config.rules['native-dialog'] !== 'off') {
    page.on('dialog', async (d) => {
      const type = d.type();
      if (type === 'beforeunload') { await d.accept().catch(() => {}); return; } // the browser's own "Leave site?" prompt is fine
      const at = dialogAt; dialogAt = null;
      await d.dismiss().catch(() => {});
      const text = d.message().replace(/\s+/g, ' ').trim();
      if (phase !== 'main' || dialogsSeen.has(type + text)) return;
      dialogsSeen.add(type + text);
      const shown = text ? `: "${text.length > 120 ? text.slice(0, 117) + '…' : text}"` : '';
      issues.push({ rule: 'native-dialog', severity: 'error',
        message: `${type}()${shown ? ' ' + shown.slice(2) : ''} opened the browser's native dialog${at ? `, called at ${at.replace(origin, '')}` : ''}${at ? '' : ` (search the source for ${type}( )`}. ${dialogAdvice(type)}`,
        details: { type, text, ...(at ? { at } : {}) } });
    });
  }
  page.on('console', (m) => {
    if (m.type() === 'debug' && m.text().startsWith('[renderlint:dialog] ')) { dialogAt = m.text().slice(20) || null; return; }
    if (m.type() !== 'error' || config.rules['console-error'] === 'off' || phase !== 'main') return;
    const text = m.text();
    if (/Failed to load resource|favicon|net::ERR_|Download the React DevTools|\[vite\]|\[HMR\]/i.test(text)) return;
    const loc = m.location() && m.location().url;
    if (loc && !loc.startsWith(origin) && !loc.startsWith('webpack') && !/^(?:blob|data):/.test(loc)) return;
    const msg = text.split('\n')[0].slice(0, 300);
    if (consoleSeen.has(msg)) return;
    consoleSeen.add(msg);
    issues.push({ rule: 'console-error', severity: /hydrat/i.test(text) ? 'error' : 'warn', message: 'console.error: ' + msg });
  });
  const failed = new Set();
  const jsonReads = [];
  page.on('response', (r) => {
    if (phase !== 'main') return;
    if (/^(fetch|xhr)$/.test(r.request().resourceType()) && /json/.test(r.headers()['content-type'] || '') && !notStressed(r.url(), config)) {
      sawJson = true;
      // route coverage: ids and slugs in the app's API lists are instances of its dynamic routes
      if (onJson && r.status() < 300 && +(r.headers()['content-length'] || 0) < 2e6) jsonReads.push(r.json().then((b) => onJson(r.url(), b)).catch(() => {}));
    }
    const u = r.url();
    if (r.status() < 400 || !u.startsWith(origin) || /favicon|apple-touch-icon|\.map(\?|$)|__nextjs|_next\/webpack-hmr|\/@vite\//.test(u)) return;
    const type = r.request().resourceType();
    if (sources.length && /^(fetch|xhr)$/.test(type) && r.status() >= 400 && r.status() !== 401 && r.status() !== 403 && !failed.has(u) && !routes.answered.has(r.request())) {
      // With "mockFrom", the backend usually isn't running: a request the HAR or handlers don't cover fails,
      // and the page is checked without that data. Say so, rather than pass a page that rendered nothing.
      failed.add(u);
      issues.push({ rule: 'broken-resource', severity: 'warn', message: `API request not covered by "mockFrom" failed (${r.status()}): ${r.request().method()} ${u.replace(origin, '')}. This page was checked without that data.`, details: { url: u, status: r.status(), type, unmocked: true } });
      return;
    }
    if (!/stylesheet|script|image|font|media/.test(type)) return;
    if (failed.has(u)) return;
    failed.add(u);
    issues.push({ rule: 'broken-resource', severity: 'error', message: `${type} failed to load (${r.status()}): ${u.replace(origin, '')}`, details: { url: u, status: r.status(), type } });
  });

  let meta, screenshot, error, sig, stressReused = false, httpStatus = null, finalUrl = null, denied = null, resources = null, features = null;
  let mine = null, dupOf = null; // this run shares its later passes (mine), or uses those of an identical rendering (dupOf)
  let templateOf = null; // dedupe: "template": the earlier page with the same skeleton, whose stress and sweep stand for this one
  const T = { t: Date.now() };
  const lap = (name) => { if (process.env.RENDERLINT_DEBUG) { const n = Date.now(); log(`    [${vp.width}] ${name}: ${n - T.t}ms`); T.t = n; } };
  try {
    let resp;
    for (let attempt = 0; ; attempt++) {
      try { resp = await page.goto(url, { waitUntil: 'load', timeout: config.timeout }); break; } catch (e) {
        if (attempt >= 1 || !/net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|ABORTED|INTERNET_DISCONNECTED)/.test(String(e))) throw e;
        await page.waitForTimeout(1000);
      }
    }
    const serverCalls = () => (run && serverLog ? serverLog.entries(run) : []);
    const status = resp ? resp.status() : 0;
    if (status >= 400 && !(detect && (status === 401 || status === 403))) {
      // An SSR page whose server-side requests failed: say which, so they can be mocked.
      const failedCalls = serverCalls().filter((e) => !e.mocked && (e.error || e.status >= 400));
      const list = Array.from(new Set(failedCalls.map((e) => `${e.method} ${e.url} (${e.error || 'HTTP ' + e.status})`))).slice(0, 5);
      issues.push({ rule: 'page-error', severity: 'error', message: `Page responded with HTTP ${status}.` + (list.length ? ` The server's own requests failed: ${list.join(', ')}. Add them to "mock" (renderlint serves them on the server too).` : ''), ...(list.length ? { details: { serverRequests: failedCalls } } : {}) });
    }
    httpStatus = resp ? resp.status() : null;
    lap('goto');
    await waitReady(page, net, 4000);
    lap('networkidle');
    if (config.waitFor) await page.waitForSelector(config.waitFor, { timeout: config.timeout }).catch(() => {});
    if (config.delay) await page.waitForTimeout(config.delay);
    const st = await page.evaluate(SETTLE_SCRIPT, { autoScroll: config.autoScroll });
    if (process.env.RENDERLINT_DEBUG) log('    settle marks: ' + st.join(', '));
    lap('settle');
    // Sent to a login page or identity provider: the page itself was never rendered, so don't lint the login form in its name.
    if (jsonReads.length) await Promise.all(jsonReads);
    finalUrl = page.url();
    if (probe) {
      // for the coverage report: a page that renders "access denied" in place of its content, and the files it loaded
      ({ denied, resources, features } = await page.evaluate(PROBE_SCRIPT).catch(() => ({})));
    }
    const redirect = loginRedirect(url, page.url(), await page.evaluate(() => Array.from(document.querySelectorAll('input[type=password]')).some((i) => i.getClientRects().length)).catch(() => false));
    // Replaying a test's page: the test was there, so landing anywhere else (a sign-in page, a role guard's
    // redirect, a page that needs in-memory state) means the state didn't carry over, not a defect.
    if (replay && (redirect || normalizeUrl(page.url()) !== normalizeUrl(url))) {
      return { issues: [], meta: null, screenshot: null, error: null, skipped: `landed on ${pathOf(page.url(), new URL(url).origin)} instead` };
    }
    if (redirect && config.rules['auth-required'] !== 'off') {
      const what = new URL(url), asked = what.pathname + what.search + hashRoute(what);
      issues.length = 0;
      // A page found by crawling, or a site whose home page is the sign-in page, is a warning; a page you listed is an error.
      const home = !config.auth && (what.pathname === '/' || what.pathname === '') && !hashRoute(what);
      issues.push({ rule: 'auth-required', severity: crawled || home ? 'warn' : 'error',
        message: `${asked} was not checked: the app sent renderlint to ${redirect.external ? 'the sign-in page at ' + redirect.to : redirect.to} instead. ` +
          (config.auth ? 'The session from "auth" was not accepted here (expired, wrong role, or a token the guard doesn\'t read).' : 'Pages behind a login need "auth" in renderlint.config (log in once, or set the token your route guard reads and mock the API: no backend needed).'),
        details: { redirectedTo: redirect.to, external: redirect.external } });
      return { issues, meta: null, screenshot: null, error: null, landed: redirect.external ? null : page.url(), notShown: { kind: 'login', to: redirect.to }, httpStatus, finalUrl, denied, resources, features };
    }
    // Signed in, the app may still not show the page: a role guard's redirect (/admin → /dashboard), an
    // HTTP 401/403, or "Access denied" / "Page not found" rendered in its place. Its UI was never rendered:
    // don't check what was shown instead in its name. Ordinary redirects (trailing slash, a section's default child) don't count.
    if (detect) {
      const to = redirectedTo(url, page.url());
      const screen = to ? null : status === 401 || status === 403 ? { kind: 'denied', text: `HTTP ${status}`, status } : await page.evaluate(NOT_SHOWN_SCRIPT).catch(() => null);
      if (to || screen) {
        issues.length = 0;
        return { issues, meta: null, screenshot: null, error: null, landed: to && new URL(page.url()).origin === origin ? page.url() : null, notShown: to ? { kind: 'redirect', to } : screen, httpStatus, finalUrl, denied, resources, features };
      }
    }
    if (config.beforeCheck) await config.beforeCheck(page, { viewport: vp, scheme });
    if (state) await applyState(page, state, { viewport: vp, scheme });
    await page.evaluate(source);
    const res = await page.evaluate((o) => window.__renderlint.analyze(o), { ...analyzeOpts, contrastCandidates: false });
    meta = res.meta;
    if (discover && meta) meta.routes = await page.evaluate(DISCOVER_ROUTES).catch(() => null);
    if (onMeta) onMeta(meta);
    for (const e of res.errors) log('  analyzer error: ' + e);
    lap('analyze');
    issues.push(...res.issues);

    // dead links: confirm there is no real click listener via CDP
    const dead = issues.filter((i) => i.needsListenerCheck);
    if (dead.length) await confirmDeadLinks(page, dead, issues);
    lap('deadlinks');

    if (analyzeOpts.contrastCandidates || reps) {
      // the occlusion rules scroll the page, which can start reveal animations: settle again first
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.__renderlint.finishAnimations(); });
      await page.waitForTimeout(50);
      await page.evaluate(() => { window.__renderlint.finishAnimations(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    }
    // A page that renders exactly like one checked before (same DOM, text, boxes and resources: SPA fallbacks,
    // duplicate URLs) gets the same contrast, stress, sweep and data findings: they are computed once.
    const { fp, skeleton } = reps ? await page.evaluate(FINGERPRINT_SCRIPT, { template: !!template }).catch(() => ({})) : {};
    if (template) {
      // Opt-in (dedupe: "template"): a page built like an earlier one runs only the base checks.
      if (template.publish) { template.publish(skeleton || null); templateOf = skeleton ? await template.decide(skeleton) : null; template.decision.resolve(templateOf); }
      else templateOf = await template.decision.promise;
      if (templateOf) lap('template of ' + templateOf);
    }
    if (fp) {
      const key = [vp.width, vp.height, scheme, focus ? 'f' : '', sweep.join(), fp].join('|');
      const other = reps.get(key);
      if (!other) reps.set(key, (mine = { path: new URL(url).pathname + new URL(url).search, base: deferred(), rest: deferred() }));
      else if ((dupOf = await other.base.promise)) { dupOf.path = other.path; dupOf.rest = other.rest.promise; issues.push(...dupOf.extra.map(cloneIssue)); }
      lap('fingerprint' + (dupOf ? ' (renders like ' + dupOf.path + ')' : ''));
    }
    const iExtra = issues.length;

    if (analyzeOpts.contrastCandidates && !dupOf) {
      const candidates = await page.evaluate(() => window.__renderlint.collectContrast(true));
      const c = await measureContrast(page, candidates, { maxHeight: config.maxScreenshotHeight, level: config.contrastLevel, check: process.env.RENDERLINT_CONTRAST_CHECK });
      issues.push(...c);
    }
    lap('contrast');

    if (config.rules['dropdown-arrow'] !== 'off' && !dupOf) {
      const cands = await page.evaluate(() => window.__renderlint.dropdownCandidates());
      if (cands.length) issues.push(...await measureDropdowns(page, cands));
    }
    lap('dropdowns');

    // Open each menu, dropdown and popover trigger, and check that what it opens can be seen.
    if (menus && !dupOf) {
      const shot = config.screenshots ? async (issue, n) => {
        const file = join(outDir, 'screens', `${slugFor(url, config.role && config.role.name)}@${vp.width}-menu${n + 1}.png`);
        issue.marker = 1;
        issue.ownShot = true;
        await annotate(page, [issue], config);
        const rs = [issue.rect, issue.related && issue.related.rect].filter(Boolean);
        const top = Math.max(0, Math.min(...rs.map((r) => r.y)) - 160), bottom = Math.max(...rs.map((r) => r.y + r.h)) + 160;
        await writeShot(page, file, { x: 0, y: top, width: vp.width, height: Math.min(1600, Math.max(200, bottom - top)) });
        await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
        return file;
      } : null;
      const m = await checkMenus(page, { shot });
      issues.push(...m.issues);
      if (m.disturbed) {
        // a menu that wouldn't close, or a trigger that navigated: start again from a fresh load
        await page.goto(url, { waitUntil: 'load', timeout: config.timeout });
        await waitReady(page, net, 4000);
        await page.evaluate(SETTLE_SCRIPT, { autoScroll: config.autoScroll });
        await page.evaluate(source);
      }
    }
    lap('menus');
    const extra = issues.slice(iExtra);

    if (focus) {
      const f = await page.evaluate(() => window.__renderlint.focusCheck(30));
      issues.push(...f);
      // Focusing and blurring can open things that close on a timer (a search box's
      // results closing 120ms after blur): let them close before the next checks.
      await page.evaluate(() => window.__rlWaitQuiet && window.__rlWaitQuiet(500, 2));
    }
    lap('focus');

    if (config.screenshots) {
      // Mark errors (or warnings when there are no errors) so the screenshot stays readable.
      const visible = issues.filter((i) => i.rect && !i.ownShot && effectiveSeverity(i, config) !== 'off'); // an open menu has its own screenshot
      const errs = visible.filter((i) => effectiveSeverity(i, config) === 'error');
      const shown = errs.length ? errs : visible;
      if (shown.some((i) => !marked.has(groupKey(i)))) {
        screenshot = join(outDir, 'screens', `${slugFor(url, config.role && config.role.name)}@${vp.width}${scheme === 'dark' ? '-dark' : ''}.png`);
        shown.forEach((i, n) => { i.marker = n + 1; });
        const shownSig = JSON.stringify(shown.map((i) => [i.rule, i.selector, i.message, i.rect, i.related && i.related.rect]));
        if (dupOf && dupOf.screenshot && dupOf.shownSig === shownSig) copyFileSync(dupOf.screenshot, screenshot);
        else {
          await annotate(page, shown, config);
          const clip = { x: 0, y: 0, width: meta.width, height: Math.min(config.maxScreenshotHeight, meta.height) };
          await writeShot(page, screenshot, clip);
          await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
        }
        for (const i of shown) marked.add(groupKey(i));
        if (mine) mine.base.resolve({ extra: extra.map(cloneIssue), shownSig, screenshot });
      }
    }
    if (mine) mine.base.resolve({ extra: extra.map(cloneIssue) });
    const markedHere = new Set(issues.filter((i) => i.marker).map(groupKey));
    lap('screenshot');
    const iRest = issues.length;
    if (dupOf) return { issues, meta, screenshot, reuse: { path: dupOf.path, rest: dupOf.rest }, httpStatus, finalUrl, denied, resources, features };

    // Taken just before the stress passes, in the state they start from (after contrast, focus, screenshot).
    const ref = config.stress && refSig ? await refSig : null;
    if (config.stress && !templateOf && meta && (ref || (wantSig && wantSig(meta)))) {
      sig = await page.evaluate(() => window.__renderlint.schemeSignature());
      if (sig.paintOnly && sig.crossOrigin.length) sig.paintOnly = await crossOriginPaintOnly(context, sig.crossOrigin, cssCache);
      if (onSig) onSig(sig);
      stressReused = !!(ref && sig.paintOnly && ref.paintOnly && sig.sig === ref.sig);
      lap('scheme-signature' + (refSig ? (stressReused ? ' (same layout)' : ' (layout differs)') : ''));
    }

    if (config.stress && !templateOf && !stressReused) {
      await stressPasses(page, issues, analyzeOpts, config);
      lap('stress');
    }

    // Responsive sweep: layouts often fit at the tested widths and break in between
    // (1100px, 1366px…). Resize in place and re-run the layout rules at each width.
    let sweepWidths = [];
    if (sweep.length && !templateOf) {
      const all = bpSweep ? breakpointWidths(sweep, await page.evaluate(() => window.__renderlint.breakpoints())) : sweep;
      sweepWidths = sweepAssignment(all, viewports).get(vp.width) || [];
      if (process.env.RENDERLINT_DEBUG) log(`    [${vp.width}] sweep widths: ${sweepWidths.join(', ')}`);
    }
    if (sweepWidths.length) {
      await sweepPasses(page, { widths: sweepWidths, vp, issues, analyzeOpts, config, outDir, url, scheme, marked, markedHere, role: config.role && config.role.name });
      lap('sweep');
    }

    if (config.stress && !templateOf && !stressReused) {
      const stressRules = Object.fromEntries(Object.keys(RULES).map((k) => [k, STRESSED_RULES.includes(k) ? (config.rules[k] === 'off' ? 'off' : 'error') : 'off']));
      const stressOpts = { ...analyzeOpts, ignoreSelectors: ignoreSelectorsFor(analyzeOpts.ignoreSelectors), alsoIgnore: 'fragile-layout', rules: stressRules, contrastCandidates: false };
      const known = new Set(issues.filter((i) => !i.sweepWidth).map((i) => i.rule + '|' + i.selector));
      const collect = (found, label, profile, severity) => {
        for (const i of found) {
          const key = i.rule + '|' + i.selector;
          if (known.has(key)) continue;
          known.add(key);
          issues.push({ ...i, rule: 'fragile-layout', severity, message: `${label}: ${i.message}`, details: { ...(i.details || {}), stressedRule: i.rule, profile } });
        }
      };
      // Data stress: reload with the app's JSON responses rewritten (longer names, titles,
      // emails), so content rendered from an API is tested through the app's own code path.
      // Server-rendered data counts too: the preload lengthens the JSON the server fetched for this page.
      const serverJson = run && serverLog && serverLog.entries(run).some((e) => e.json && !(e.status >= 300));
      if (config.stressData !== false && (sawJson || serverJson)) {
        phase = 'data';
        routes.stressData = Math.max(2, config.stress);
        try {
          await ensureRoutes();
          if (serverJson) await context.addCookies([{ name: STRESS_COOKIE, value: String(routes.stressData), url: new URL(url).origin }]);
          await page.reload({ waitUntil: 'load', timeout: config.timeout });
          await waitReady(page, net, 4000);
          if (config.waitFor) await page.waitForSelector(config.waitFor, { timeout: config.timeout }).catch(() => {});
          if (config.delay) await page.waitForTimeout(config.delay);
          await page.evaluate(SETTLE_SCRIPT, { autoScroll: config.autoScroll });
          if (config.beforeCheck) await config.beforeCheck(page, { viewport: vp, scheme });
          if (state) await applyState(page, state, { viewport: vp, scheme });
          await page.evaluate(source);
          const dres = await page.evaluate((o) => window.__renderlint.analyze(o), stressOpts);
          collect(dres.issues, 'With longer data from the API (names, titles, emails)', 'data');
        } catch (e) {
          log(`  data stress skipped on ${url}: ${String(e && e.message || e).split('\n')[0]}`);
        }
        lap('data-stress');
      }
    }
    if (mine) mine.rest.resolve({ issues: issues.slice(iRest).map(cloneIssue) });
  } catch (e) {
    error = String(e && e.message || e).split('\n')[0];
  } finally {
    if (mine) { mine.base.resolve(null); mine.rest.resolve({ error: error || 'failed' }); }
    if (template && template.publish) { template.publish(null); template.decision.resolve(null); }
    await context.close().catch(() => {});
  }
  const server = run && serverLog ? serverLog.entries(run).filter((e) => e.page && !/^\/(_next|__nuxt|@|node_modules)/.test(e.page)).map(({ method, url: u, mocked, status: st, error: err }) => ({ method, url: u, mocked, ...(st ? { status: st } : {}), ...(err ? { error: err } : {}) })) : [];
  return { issues, meta, screenshot, error, templateOf, stressReused, httpStatus, finalUrl, denied, resources, features, server: Array.from(new Map(server.map((e) => [e.method + ' ' + e.url, e])).values()) };
}

// Stress passes on a loaded page: rewrites its text (longer, long words, big numbers, declared
// samples), re-runs the layout rules and restores the text. New findings become fragile-layout.
export async function stressPasses(page, issues, analyzeOpts, config) {
  const stressRules = Object.fromEntries(Object.keys(RULES).map((k) => [k, STRESSED_RULES.includes(k) ? (config.rules[k] === 'off' ? 'off' : 'error') : 'off']));
  const stressOpts = { ...analyzeOpts, ignoreSelectors: ignoreSelectorsFor(analyzeOpts.ignoreSelectors), alsoIgnore: 'fragile-layout', rules: stressRules, contrastCandidates: false };
  const known = new Set(issues.map((i) => i.rule + '|' + i.selector));
  const collect = (found, label, profile, severity) => {
    for (const i of found) {
      const key = i.rule + '|' + i.selector;
      if (known.has(key)) continue;
      known.add(key);
      issues.push({ ...i, rule: 'fragile-layout', severity, message: `${label}: ${i.message}`, details: { ...(i.details || {}), stressedRule: i.rule, profile } });
    }
  };
  const pct = Math.round((config.stress - 1) * 100);
  for (const p of [
    { id: 'declared', label: 'With the worst-case text declared on the element', severity: 'error' },
    { id: 'longer', label: `With ~${pct}% longer text` },
    { id: 'long-words', label: 'With a long unbreakable word (email, URL or ID)' },
    { id: 'big-numbers', label: 'With bigger numbers (three more digits)' },
  ]) {
    if (p.id === 'longer' && config.stress <= 1) continue;
    const n = await page.evaluate(([id, f]) => window.__renderlint.stress(id, f), [p.id, config.stress]);
    if (!n) continue;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const sres = await page.evaluate((o) => window.__renderlint.analyze(o), stressOpts);
    await page.evaluate(() => window.__renderlint.unstress());
    collect(sres.issues, p.label, p.id, p.severity);
  }
}

// Responsive sweep on a loaded page: layouts often fit at the tested widths and break in between
// (1100px, 1366px…). Resizes in place, re-runs the layout rules at each width, then restores vp.
export async function sweepPasses(page, { widths, vp, issues, analyzeOpts, config, outDir, url, scheme, marked, markedHere, role }) {
  const sweepRules = Object.fromEntries(Object.keys(RULES).map((k) => [k, STRESSED_RULES.includes(k) && config.rules[k] !== 'off' ? (config.rules[k] || RULES[k].severity) : 'off']));
  const sweepOpts = { ...analyzeOpts, rules: sweepRules, contrastCandidates: false };
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: vp.height });
    // resize listeners, container queries, JS breakpoints (debounced ones too)
    // (at most the 150ms this used to wait; ends once nothing is due or changing)
    if (await page.evaluate(() => (window.__rlWaitQuiet ? window.__rlWaitQuiet(150, 2) : null)) === null) await page.waitForTimeout(150);
    await page.evaluate(() => { window.__renderlint.finishAnimations(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
    const r = await page.evaluate((o) => window.__renderlint.analyze(o), sweepOpts);
    const found = r.issues.map((i) => ({ ...i, sweepWidth: w, details: { ...(i.details || {}), sweep: true } }));
    const shown = found.filter((i) => i.rect && effectiveSeverity(i, config) === 'error');
    if (config.screenshots && shown.length && shown.some((i) => !marked.has(groupKey(i)) && !markedHere.has(groupKey(i)))) {
      const shot = join(outDir, 'screens', `${slugFor(url, role)}@${w}${scheme === 'dark' ? '-dark' : ''}.png`);
      shown.forEach((i, n) => { i.marker = n + 1; i.screenshot = shot; markedHere.add(groupKey(i)); marked.add(groupKey(i)); });
      await annotate(page, shown, config);
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
      const clip = { x: 0, y: 0, width: w, height: Math.min(config.maxScreenshotHeight, h) };
      await writeShot(page, shot, clip);
      await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
    }
    issues.push(...found);
  }
  await page.setViewportSize({ width: vp.width, height: vp.height });
}

// What a page says when the session lacks the role (headings and alerts only, short text), and the
// same-origin files it loaded (Vite serves each source module at its own path; public/ assets).
const PROBE_SCRIPT = () => {
  const DENIED = /\b(access denied|permission denied|forbidden|not authori[sz]ed|unauthori[sz]ed|insufficient (permissions|privileges)|you (do not|don't|don’t) have (access|permission)|admins? only|403)\b/i;
  let denied = null;
  for (const el of document.querySelectorAll('h1, h2, h3, [role="alert"]')) {
    const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (t && t.length <= 80 && DENIED.test(t) && el.getClientRects().length) { denied = t; break; }
  }
  const resources = Array.from(new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.startsWith(location.origin)).map((n) => new URL(n).pathname))).slice(0, 2000);
  // how extreme this instance of its route is: longest unbroken word, longest text, amount of text,
  // size, horizontal overflow, broken images, and its layout skeleton (for choosing which instances to check fully)
  let maxWord = 0, maxText = 0, textTotal = 0;
  const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(), k = 0; n && k < 20000; n = w.nextNode(), k++) {
    const t = n.data.trim();
    if (!t || !n.parentElement || !n.parentElement.getClientRects().length) continue;
    textTotal += t.length;
    if (t.length > maxText) maxText = t.length;
    for (const word of t.split(/\s+/)) if (word.length > maxWord) maxWord = word.length;
  }
  const shape = (el, d) => { const kids = []; if (d < 40) for (const c of el.children) { const k = shape(c, d + 1); if (kids[kids.length - 1] !== k) kids.push(k); } return el.tagName + (el.classList.length ? '.' + Array.from(el.classList).sort().join('.') : '') + (kids.length ? '[' + kids.join(',') + ']' : ''); };
  let h = 0; const sk = document.body ? shape(document.body, 0) : '';
  for (let i = 0; i < sk.length; i++) h = (Math.imul(h, 31) + sk.charCodeAt(i)) | 0;
  const imgs = Array.from(document.images);
  const features = { maxWord, maxText, textTotal, elements: document.getElementsByTagName('*').length, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    height: document.documentElement.scrollHeight, broken: imgs.filter((i) => i.complete && !i.naturalWidth).length, skeleton: String(h) };
  return { denied, resources, features };
};

// Stylesheets the page can't read (cross-origin): fetch them. Any color-scheme condition,
// @import or var() in them could change layout per scheme, so it counts as "not paint-only".
async function crossOriginPaintOnly(context, sheets, cache) {
  for (const { href, conditioned } of sheets) {
    if (conditioned || !href) return false;
    if (!cache.has(href)) {
      cache.set(href, context.request.get(href, { timeout: 5000 }).then(async (r) => r.ok() && !/prefers-color-scheme|@import|var\(/i.test(await r.text())).catch(() => false));
    }
    if (!await cache.get(href)) return false;
  }
  return true;
}

export async function confirmDeadLinks(page, dead, issues) {
  let client;
  try { client = await page.context().newCDPSession(page); } catch { return; }
  try {
    for (const d of dead) {
      const { result } = await client.send('Runtime.evaluate', {
        expression: `(() => { const sel = ${JSON.stringify(d.selector)}; try { return document.querySelector(sel); } catch (e) { return null; } })()`,
      });
      if (!result || !result.objectId) continue;
      let hasListener = false;
      let objectId = result.objectId;
      for (let depth = 0; depth < 3 && objectId; depth++) {
        const { listeners } = await client.send('DOMDebugger.getEventListeners', { objectId, depth: 0 });
        if (listeners.some((l) => /^(click|mousedown|mouseup|pointerdown|pointerup|touchstart)$/.test(l.type))) { hasListener = true; break; }
        const parent = await client.send('Runtime.callFunctionOn', { objectId, functionDeclaration: 'function(){ const p = this.parentElement; return p && p !== document.body ? p : null; }' });
        objectId = parent.result && parent.result.objectId;
      }
      if (hasListener) issues.splice(issues.indexOf(d), 1);
    }
  } catch { /* best effort */ } finally {
    await client.detach().catch(() => {});
  }
  for (const d of dead) delete d.needsListenerCheck;
}

export function effectiveSeverity(issue, config) {
  const conf = config.rules[issue.rule];
  if (conf) return conf;
  return issue.severity || (RULES[issue.rule] ? RULES[issue.rule].severity : 'error');
}

export async function annotate(page, issues, config) {
  const boxes = issues.map((i) => ({ rect: i.rect, n: i.marker, sev: effectiveSeverity(i, config), rule: i.rule, related: i.related && i.related.rect }));
  await page.evaluate((boxes) => {
    const root = document.createElement('div');
    root.id = '__renderlint_overlay';
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    for (const b of boxes) {
      const color = b.sev === 'error' ? '#e11d48' : '#f59e0b';
      const add = (r, dashed) => {
        const d = document.createElement('div');
        d.style.cssText = `position:absolute;left:${r.x - 2}px;top:${r.y - 2}px;width:${r.w + 4}px;height:${r.h + 4}px;border:2px ${dashed ? 'dashed' : 'solid'} ${color};box-sizing:border-box;border-radius:3px`;
        root.appendChild(d);
        return d;
      };
      if (b.related) add(b.related, true);
      add(b.rect, false);
      const tag = document.createElement('div');
      tag.textContent = '#' + b.n + ' ' + b.rule;
      tag.style.cssText = `position:absolute;left:0;top:0;background:${color};color:#fff;font:600 11px/16px system-ui,sans-serif;padding:0 4px;border-radius:3px;white-space:nowrap`;
      root.appendChild(tag);
      b.tag = tag;
    }
    document.documentElement.appendChild(root);

    // Place each label where it hides the least: not over the flagged element, other text or other labels.
    const pageW = document.documentElement.clientWidth; // the screenshot is the viewport wide
    const near = (r, m) => boxes.some((b) => r.x < b.rect.x + b.rect.w + m && r.x + r.w > b.rect.x - m && r.y < b.rect.y + b.rect.h + m && r.y + r.h > b.rect.y - m);
    // Text that is actually painted: not hidden, and not clipped away (a collapsed accordion still has text rects).
    const shown = (el, r) => {
      for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (st.visibility === 'hidden' || st.opacity === '0' || st.display === 'none') return false;
        if (st.overflowX !== 'visible' || st.overflowY !== 'visible') {
          const q = e.getBoundingClientRect(), bx = q.left + scrollX, by = q.top + scrollY;
          if (r.x + r.w <= bx || r.x >= bx + q.width || r.y + r.h <= by || r.y >= by + q.height) return false;
        }
      }
      return true;
    };
    const texts = [];
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let t = walker.nextNode(); t && texts.length < 4000; t = walker.nextNode()) {
      if (!t.data.trim() || root.contains(t)) continue;
      range.selectNodeContents(t);
      for (const q of range.getClientRects()) {
        const r = { x: q.left + scrollX, y: q.top + scrollY, w: q.width, h: q.height };
        if (r.w > 0 && r.h > 0 && near(r, 90) && shown(t.parentElement, r)) texts.push(r);
      }
    }
    const overlap = (a, c) => Math.max(0, Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x)) * Math.max(0, Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y));
    const placed = [];
    for (const b of boxes) {
      const w = b.tag.offsetWidth, h = b.tag.offsetHeight, r = b.rect;
      const spots = [
        [r.x - 2, r.y - h - 2], [r.x - 2, r.y + r.h + 3], [r.x + r.w - w + 2, r.y - h - 2], [r.x + r.w - w + 2, r.y + r.h + 3],
        [r.x + r.w + 4, r.y], [r.x - w - 4, r.y], [r.x + r.w - w - 2, r.y + 2],
      ];
      let best = null;
      for (const [i, [x, y]] of spots.entries()) {
        const cand = { x, y, w, h };
        if (x < 0 || y < 0 || x + w > pageW) continue;
        let cost = i * 4; // prefer the usual spot above the box
        for (const t of texts) cost += overlap(cand, t);
        for (const o of boxes) cost += overlap(cand, o.rect) * (o === b ? 3 : 1);
        for (const p of placed) cost += overlap(cand, p) * 5;
        if (!best || cost < best.cost) best = { ...cand, cost };
      }
      if (!best) best = { x: Math.max(0, Math.min(r.x - 2, pageW - w)), y: Math.max(0, r.y - h - 2), w, h };
      b.tag.style.left = best.x + 'px';
      b.tag.style.top = best.y + 'px';
      placed.push(best);
      delete b.tag;
    }
  }, boxes);
}

export function writeJson(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }
