// Drives a headless browser over pages × viewports × color schemes and
// collects issues from the in-page analyzer plus screenshot-based checks.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzerSource } from './analyzer/bundle.js';
import { measureContrast } from './contrast.js';
import { measureDropdowns } from './controls.js';
import { RULES } from './rules-meta.js';
import { stressJson } from './stress-data.js';

const SETTLE_SCRIPT = async ({ autoScroll }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const T = [performance.now()]; const mark = () => T.push(Math.round(performance.now() - T[0]));
  // Never mutate <html>/<body> attributes here: frameworks may still be hydrating.
  if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, sleep(3000)]);
  mark();
  document.querySelectorAll('img[loading="lazy"]').forEach((i) => { i.loading = 'eager'; });
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
  mark();
  return T.slice(1);
};

function slugFor(url) {
  const u = new URL(url);
  const s = (u.pathname.replace(/\/+$/, '') || '/index').replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'index';
  const name = (s + (u.search ? '-' + u.search.replace(/[^a-z0-9]+/gi, '-') : '')).slice(0, 60);
  let h = 0;
  for (const ch of u.pathname + u.search) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return name + '-' + h.toString(36).slice(0, 5);
}

const NAV_SKIP = /\.(pdf|zip|png|jpe?g|gif|svg|webp|avif|mp4|webm|mp3|xml|txt|json|css|js|ico|woff2?)(\?|#|$)/i;

export async function runChecks(browser, { urls, config, log = () => {} }) {
  const viewports = config.viewports;
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

  const queue = urls.slice();
  const visited = new Set(queue.map(normalizeUrl));
  const origin = new URL(urls[0]).origin;
  const allIssues = [];
  const pages = [];

  let darkSeen = false;
  const states = (config.states || []).map((st) => ({ ...st, url: st.page ? new URL(st.page, urls[0]).href : urls[0] }));
  while ((queue.length && pages.length < config.maxPages) || states.length) {
    const state = queue.length && pages.length < config.maxPages ? null : states.shift();
    const url = state ? state.url : queue.shift();
    const pageInfo = { url, path: pathOf(url, origin) + (state ? ` [state: ${state.name}]` : ''), runs: [] };
    pages.push(pageInfo);
    let schemes = config.colorSchemes === 'auto' ? (darkSeen && state ? ['light', 'dark'] : ['light']) : config.colorSchemes.slice();
    for (let si = 0; si < schemes.length; si++) {
      const scheme = schemes[si];
      // viewports run concurrently in separate browser contexts
      const sweepFor = sweepAssignment(state || si > 0 ? [] : config.sweep, viewports);
      const results = await mapLimit(viewports, config.concurrency || 3, async (vp, vi) => {
        const t0 = Date.now();
        const res = await checkOne(browser, url, { vp, scheme, config, source, analyzeOpts, outDir, state, sweepWidths: sweepFor.get(vp.width) || [], focus: !state && si === 0 && vi === 0 && config.rules['focus-indicator'] !== 'off', log });
        log(`  ${pageInfo.path} @${vp.width}px ${scheme}: ${res.issues.length} finding(s) in ${Date.now() - t0}ms`);
        return { vp, res, ms: Date.now() - t0 };
      });
      for (const { vp, res, ms } of results) {
        pageInfo.runs.push({ viewport: vp.width, scheme, ms, issues: res.issues.length, screenshot: res.screenshot, error: res.error });
        for (const is of res.issues) allIssues.push({ ...is, page: pageInfo.path, url, viewport: is.sweepWidth || vp.width, scheme, screenshot: is.sweepWidth ? is.screenshot : res.screenshot, ...(state ? { state: state.name } : {}) });
        if (res.error) allIssues.push({ rule: 'page-error', severity: 'error', message: 'renderlint could not load or analyze this page: ' + res.error, page: pageInfo.path, url, viewport: vp.width, scheme });
        if (config.colorSchemes === 'auto' && scheme === 'light' && res.meta && res.meta.darkModeCss && !schemes.includes('dark')) { schemes.push('dark'); darkSeen = true; }
        if (config.crawl && !state && res.meta && si === 0) {
          for (const link of res.meta.links) {
            let u;
            try { u = new URL(link); } catch { continue; }
            if (u.origin !== origin || NAV_SKIP.test(u.pathname)) continue;
            u.hash = '';
            const key = normalizeUrl(u.href);
            if (visited.has(key)) continue;
            if ((config.exclude || []).some((p) => globMatch(p, u.pathname))) continue;
            visited.add(key);
            queue.push(u.href);
          }
        }
      }
    }
  }
  return { issues: allIssues, pages };
}

// Spread sweep widths over the configured viewports: each runs in the context
// (touch, height) of the nearest tested width.
function sweepAssignment(widths, viewports) {
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

const STRESSED_RULES = ['text-overflow', 'text-crowding', 'text-clipped', 'content-overflow', 'viewport-overflow', 'text-overlap', 'element-overlap'];

// Mocked responses (config.mock / state.mock) and data stress share one route handler.
async function handleRoute(route, routes) {
  const req = route.request();
  const spec = mockFor(req.url(), routes.mock);
  try {
    if (spec) {
      let body = spec.file ? readFileSync(spec.file, 'utf8') : spec.body !== undefined ? (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body)) : JSON.stringify(spec.json !== undefined ? spec.json : spec.data);
      const isJson = spec.file ? /\.json$/i.test(spec.file) : typeof spec.body !== 'string';
      if (routes.stressData && isJson) { try { body = JSON.stringify(stressJson(JSON.parse(body), routes.stressData)); } catch { /* not JSON */ } }
      return await route.fulfill({ status: spec.status || 200, headers: { 'content-type': isJson ? 'application/json' : 'text/plain', ...(spec.headers || {}) }, body });
    }
    if (!routes.stressData || !/^(fetch|xhr)$/.test(req.resourceType())) return await route.fallback();
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

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function normalizeUrl(u) { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; } }
function pathOf(url, origin) { const u = new URL(url); return u.origin === origin ? (u.pathname + u.search) : url; }
export function globMatch(pattern, str) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(str);
}

async function checkOne(browser, url, { vp, scheme, config, source, analyzeOpts, outDir, state, sweepWidths = [], focus, log }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: scheme,
    reducedMotion: config.reducedMotion ? 'reduce' : 'no-preference', bypassCSP: true, ignoreHTTPSErrors: true,
    hasTouch: vp.width < 1024, isMobile: false, ...(config.contextOptions || {}),
  });
  const page = await context.newPage();
  const issues = [];
  const origin = new URL(url).origin;
  // Console errors and failed requests count only in the main pass, not while data is stressed.
  let phase = 'main', sawJson = false;
  const routes = { mock: { ...(config.mock || {}), ...((state && state.mock) || {}) }, stressData: false };
  let routed = false;
  const ensureRoutes = async () => { if (!routed) { routed = true; await page.route('**/*', (route) => handleRoute(route, routes)); } };
  if (Object.keys(routes.mock).length) await ensureRoutes(); // interception disables the HTTP cache, so only when needed
  const consoleSeen = new Set();
  page.on('pageerror', (err) => {
    if (config.rules['console-error'] === 'off' || phase !== 'main') return;
    const msg = String(err && err.message || err).split('\n')[0].slice(0, 300);
    if (consoleSeen.has(msg)) return;
    consoleSeen.add(msg);
    issues.push({ rule: 'console-error', severity: 'error', message: 'Uncaught error: ' + msg, details: { stack: String(err && err.stack || '').split('\n').slice(0, 6).join('\n') } });
  });
  page.on('console', (m) => {
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
  page.on('response', (r) => {
    if (phase !== 'main') return;
    if (/^(fetch|xhr)$/.test(r.request().resourceType()) && /json/.test(r.headers()['content-type'] || '')) sawJson = true;
    const u = r.url();
    if (r.status() < 400 || !u.startsWith(origin) || /favicon|apple-touch-icon|\.map(\?|$)|__nextjs|_next\/webpack-hmr|\/@vite\//.test(u)) return;
    const type = r.request().resourceType();
    if (!/stylesheet|script|image|font|media/.test(type)) return;
    if (failed.has(u)) return;
    failed.add(u);
    issues.push({ rule: 'broken-resource', severity: 'error', message: `${type} failed to load (${r.status()}): ${u.replace(origin, '')}`, details: { url: u, status: r.status(), type } });
  });

  let meta, screenshot, error;
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
    if (resp && resp.status() >= 400) {
      issues.push({ rule: 'page-error', severity: 'error', message: `Page responded with HTTP ${resp.status()}.` });
    }
    lap('goto');
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
    lap('networkidle');
    if (config.waitFor) await page.waitForSelector(config.waitFor, { timeout: config.timeout }).catch(() => {});
    if (config.delay) await page.waitForTimeout(config.delay);
    const st = await page.evaluate(SETTLE_SCRIPT, { autoScroll: config.autoScroll });
    if (process.env.RENDERLINT_DEBUG) log('    settle marks: ' + st.join(', '));
    lap('settle');
    if (config.beforeCheck) await config.beforeCheck(page, { viewport: vp, scheme });
    if (state) await applyState(page, state, { viewport: vp, scheme });
    await page.evaluate(source);
    const res = await page.evaluate((o) => window.__renderlint.analyze(o), { ...analyzeOpts, contrastCandidates: false });
    meta = res.meta;
    for (const e of res.errors) log('  analyzer error: ' + e);
    lap('analyze');
    issues.push(...res.issues);

    // dead links: confirm there is no real click listener via CDP
    const dead = issues.filter((i) => i.needsListenerCheck);
    if (dead.length) await confirmDeadLinks(page, dead, issues);
    lap('deadlinks');

    if (analyzeOpts.contrastCandidates) {
      // the occlusion rules scroll the page, which can start reveal animations: settle again first
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.__renderlint.finishAnimations(); });
      await page.waitForTimeout(50);
      await page.evaluate(() => { window.__renderlint.finishAnimations(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
      const candidates = await page.evaluate(() => window.__renderlint.collectContrast());
      const c = await measureContrast(page, candidates, { maxHeight: config.maxScreenshotHeight, level: config.contrastLevel });
      issues.push(...c);
    }
    lap('contrast');

    if (config.rules['dropdown-arrow'] !== 'off') {
      const cands = await page.evaluate(() => window.__renderlint.dropdownCandidates());
      if (cands.length) issues.push(...await measureDropdowns(page, cands));
    }
    lap('dropdowns');

    if (focus) {
      const f = await page.evaluate(() => window.__renderlint.focusCheck(30));
      issues.push(...f);
    }
    lap('focus');

    if (config.screenshots) {
      // Mark errors (or warnings when there are no errors) so the screenshot stays readable.
      const visible = issues.filter((i) => i.rect && effectiveSeverity(i, config) !== 'off');
      const errs = visible.filter((i) => effectiveSeverity(i, config) === 'error');
      const shown = errs.length ? errs : visible;
      screenshot = join(outDir, 'screens', `${slugFor(url)}@${vp.width}${scheme === 'dark' ? '-dark' : ''}.png`);
      shown.forEach((i, n) => { i.marker = n + 1; });
      await annotate(page, shown, config);
      const h = Math.min(config.maxScreenshotHeight, meta.height);
      await page.screenshot({ path: screenshot, clip: { x: 0, y: 0, width: meta.width, height: h }, fullPage: true, animations: 'disabled', caret: 'hide' });
      await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
    }
    lap('screenshot');

    if (config.stress) {
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
      lap('stress');
    }

    // Responsive sweep: layouts often fit at the tested widths and break in between
    // (1100px, 1366px…). Resize in place and re-run the layout rules at each width.
    if (sweepWidths.length) {
      const sweepRules = Object.fromEntries(Object.keys(RULES).map((k) => [k, STRESSED_RULES.includes(k) && config.rules[k] !== 'off' ? (config.rules[k] || RULES[k].severity) : 'off']));
      const sweepOpts = { ...analyzeOpts, rules: sweepRules, contrastCandidates: false };
      for (const w of sweepWidths) {
        await page.setViewportSize({ width: w, height: vp.height });
        await page.waitForTimeout(150); // resize listeners, container queries, JS breakpoints
        await page.evaluate(() => { window.__renderlint.finishAnimations(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        const r = await page.evaluate((o) => window.__renderlint.analyze(o), sweepOpts);
        const found = r.issues.map((i) => ({ ...i, sweepWidth: w, details: { ...(i.details || {}), sweep: true } }));
        const shown = found.filter((i) => i.rect && effectiveSeverity(i, config) === 'error');
        if (config.screenshots && shown.length) {
          const shot = join(outDir, 'screens', `${slugFor(url)}@${w}${scheme === 'dark' ? '-dark' : ''}.png`);
          shown.forEach((i, n) => { i.marker = n + 1; i.screenshot = shot; });
          await annotate(page, shown, config);
          const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
          await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: w, height: Math.min(config.maxScreenshotHeight, h) }, fullPage: true, animations: 'disabled', caret: 'hide' });
          await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
        }
        issues.push(...found);
      }
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);
      lap('sweep');
    }

    if (config.stress) {
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
      if (config.stressData !== false && sawJson) {
        phase = 'data';
        routes.stressData = Math.max(2, config.stress);
        try {
          await ensureRoutes();
          await page.reload({ waitUntil: 'load', timeout: config.timeout });
          await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
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
  } catch (e) {
    error = String(e && e.message || e).split('\n')[0];
  } finally {
    await context.close().catch(() => {});
  }
  return { issues, meta, screenshot, error };
}

async function confirmDeadLinks(page, dead, issues) {
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

async function annotate(page, issues, config) {
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
      tag.style.cssText = `position:absolute;left:${Math.max(0, b.rect.x - 2)}px;top:${Math.max(0, b.rect.y - 18)}px;background:${color};color:#fff;font:600 11px/16px system-ui,sans-serif;padding:0 4px;border-radius:3px;white-space:nowrap`;
      root.appendChild(tag);
    }
    document.documentElement.appendChild(root);
  }, boxes);
}

export function writeJson(path, data) { writeFileSync(path, JSON.stringify(data, null, 2)); }
