// Drives a headless browser over pages × viewports × color schemes and
// collects issues from the in-page analyzer plus screenshot-based checks.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyzerSource } from './analyzer/bundle.js';
import { measureContrast } from './contrast.js';
import { RULES } from './rules-meta.js';

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

const STRESS_SCRIPT = (factor) => {
  // Lengthen every visible text node to simulate real-world content.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|CODE|PRE)$/.test(p.tagName) || p.closest('svg')) continue;
    const txt = n.textContent.trim();
    if (txt.length <= 3 || !/\p{L}{2}/u.test(txt)) continue; // initials, numbers, icons don't grow with real data
    nodes.push(n);
  }
  for (const n of nodes) {
    const words = n.textContent.trim().split(/\s+/);
    const extra = Math.max(1, Math.round(words.length * (factor - 1)));
    const add = [];
    for (let i = 0; i < extra; i++) add.push(words[i % words.length]);
    n.textContent = n.textContent.replace(/\s*$/, '') + ' ' + add.join(' ') + (/\s$/.test(n.textContent) ? ' ' : '');
  }
  return nodes.length;
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

  while (queue.length && pages.length < config.maxPages) {
    const url = queue.shift();
    const pageInfo = { url, path: pathOf(url, origin), runs: [] };
    pages.push(pageInfo);
    let schemes = config.colorSchemes === 'auto' ? ['light'] : config.colorSchemes.slice();
    for (let si = 0; si < schemes.length; si++) {
      const scheme = schemes[si];
      // viewports run concurrently in separate browser contexts
      const results = await mapLimit(viewports, config.concurrency || 3, async (vp, vi) => {
        const t0 = Date.now();
        const res = await checkOne(browser, url, { vp, scheme, config, source, analyzeOpts, outDir, focus: si === 0 && vi === 0 && config.rules['focus-indicator'] !== 'off', log });
        log(`  ${pageInfo.path} @${vp.width}px ${scheme}: ${res.issues.length} finding(s) in ${Date.now() - t0}ms`);
        return { vp, res, ms: Date.now() - t0 };
      });
      for (const { vp, res, ms } of results) {
        pageInfo.runs.push({ viewport: vp.width, scheme, ms, issues: res.issues.length, screenshot: res.screenshot, error: res.error });
        for (const is of res.issues) allIssues.push({ ...is, page: pageInfo.path, url, viewport: vp.width, scheme, screenshot: res.screenshot });
        if (res.error) allIssues.push({ rule: 'page-error', severity: 'error', message: 'renderlint could not load or analyze this page: ' + res.error, page: pageInfo.path, url, viewport: vp.width, scheme });
        if (config.colorSchemes === 'auto' && scheme === 'light' && res.meta && res.meta.darkModeCss && !schemes.includes('dark')) schemes.push('dark');
        if (config.crawl && res.meta && si === 0) {
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

// In the stress pass, selectors ignored for fragile-layout apply to every stressed rule.
function ignoreSelectorsFor(sel) {
  const out = { ...sel };
  const extra = sel['fragile-layout'] || [];
  for (const r of ['text-overflow', 'text-clipped', 'content-overflow', 'viewport-overflow', 'text-overlap', 'element-overlap']) out[r] = [...(out[r] || []), ...extra];
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

async function checkOne(browser, url, { vp, scheme, config, source, analyzeOpts, outDir, focus, log }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, colorScheme: scheme,
    reducedMotion: config.reducedMotion ? 'reduce' : 'no-preference', bypassCSP: true, ignoreHTTPSErrors: true,
    hasTouch: vp.width < 1024, isMobile: false, ...(config.contextOptions || {}),
  });
  const page = await context.newPage();
  const issues = [];
  const origin = new URL(url).origin;
  const consoleSeen = new Set();
  page.on('pageerror', (err) => {
    if (config.rules['console-error'] === 'off') return;
    const msg = String(err && err.message || err).split('\n')[0].slice(0, 300);
    if (consoleSeen.has(msg)) return;
    consoleSeen.add(msg);
    issues.push({ rule: 'console-error', severity: 'error', message: 'Uncaught error: ' + msg, details: { stack: String(err && err.stack || '').split('\n').slice(0, 6).join('\n') } });
  });
  page.on('console', (m) => {
    if (m.type() !== 'error' || config.rules['console-error'] === 'off') return;
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

    if (config.stress && config.stress > 1) {
      const baseline = new Set(issues.map((i) => i.rule + '|' + i.selector));
      await page.evaluate(STRESS_SCRIPT, config.stress);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const stressRules = Object.fromEntries(Object.keys(RULES).map((k) => [k, ['text-overflow', 'text-clipped', 'content-overflow', 'viewport-overflow', 'text-overlap', 'element-overlap'].includes(k) ? (config.rules[k] === 'off' ? 'off' : 'error') : 'off']));
      const stressIgnore = { ...ignoreSelectorsFor(analyzeOpts.ignoreSelectors) };
      const sres = await page.evaluate((o) => window.__renderlint.analyze(o), { ...analyzeOpts, ignoreSelectors: stressIgnore, alsoIgnore: 'fragile-layout', rules: stressRules, contrastCandidates: false });
      const seen = new Set();
      for (const i of sres.issues) {
        if (baseline.has(i.rule + '|' + i.selector)) continue;
        const key = i.rule + '|' + i.selector;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ ...i, rule: 'fragile-layout', severity: undefined, message: `With ~${Math.round((config.stress - 1) * 100)}% longer text: ${i.message}`, details: { ...(i.details || {}), stressedRule: i.rule } });
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
