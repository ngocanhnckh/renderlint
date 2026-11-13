// Checks a page that is already open, in the state something else (a Playwright test) put it in:
// signed in as some role, a dialog open, step 2 of a wizard. Nothing is reloaded. Each viewport is
// reached by resizing this page in place, dark mode by emulating the color scheme; the stress and
// sweep passes run as usual. The page is left as it was found: size, color scheme, scroll, text, focus.
//
// What can't be done in place: the data stress (needs a reload with rewritten API responses) and the
// context options fixed at creation (hasTouch). Those need a fresh context: see replay in playwright.js.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { analyzerSource } from './analyzer/bundle.js';
import { measureContrast } from './contrast.js';
import { measureDropdowns } from './controls.js';
import { normalize, DEFAULTS } from './config.js';
import {
  SETTLE_SCRIPT, annotate, confirmDeadLinks, confirmUnreachable, effectiveSeverity, groupKey, slugFor, stressPasses, sweepPasses,
  breakpointWidths, sweepAssignment, writeShot, hashRoute,
} from './runner.js';

// What the user sees, as a hash: URL, text, form values and the DOM's shape. Two checks of the
// same state (ten tests that all end on the dashboard) are done once.
const STATE_KEY_SCRIPT = () => {
  const parts = [location.pathname + location.search + location.hash, document.title];
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.id === '__renderlint_overlay') continue;
      parts.push(el.tagName + '.' + (typeof el.className === 'string' ? el.className : ''));
      if ('value' in el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) parts.push(String(el.value), String(el.checked));
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  if (document.body) { walk(document.body); parts.push(document.body.innerText); }
  const s = parts.join('\n');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + s.length.toString(36);
};

export async function stateKey(page) {
  return page.evaluate(STATE_KEY_SCRIPT).catch(() => null);
}

export function liveConfig(options = {}, base = DEFAULTS) {
  return normalize({ ...base, ...options, rules: { ...(base.rules || {}), ...(options.rules || {}) } });
}

// Runs every check on `page` as it is. Returns raw findings (not merged), each tagged with
// page, url, viewport and scheme, ready for mergeIssues().
//   name: what to call this state in the report ("review dialog"); default: the URL path
//   config: a normalized renderlint config (liveConfig())
//   marked: findings already marked on a screenshot (shared across checks so each is drawn once)
export async function checkLive(page, { config, name, marked = new Set(), log = () => {}, focus = true } = {}) {
  config = config || liveConfig();
  const url = page.url();
  const u = new URL(url);
  const path = u.pathname + u.search + hashRoute(u) + (name ? ` [${name}]` : '');
  const outDir = config.outputDir;
  if (config.screenshots) mkdirSync(join(outDir, 'screens'), { recursive: true });
  const ignoreSelectors = {};
  for (const ig of config.ignore || []) if (ig.selector) (ignoreSelectors[ig.rule || '*'] = ignoreSelectors[ig.rule || '*'] || []).push(ig.selector);
  const analyzeOpts = { rules: config.rules, ignoreSelectors, skipDomContrast: true, contrastCandidates: false, scrollCheck: true, minTapTarget: config.minTapTarget, minFontSize: config.minFontSize, maxLineLength: config.maxLineLength };

  // What to put back afterwards.
  const size = page.viewportSize();
  const before = await page.evaluate(() => ({ x: scrollX, y: scrollY, dark: matchMedia('(prefers-color-scheme: dark)').matches })).catch(() => ({ x: 0, y: 0, dark: false }));
  const out = [];
  let emulated = false;
  const slugBase = slugFor(url) + (name ? '-' + String(name).replace(/[^a-z0-9]+/gi, '-').slice(0, 30) : '');
  try {
    await page.evaluate(analyzerSource());
    // Don't scroll through the page to trigger lazy content here: the test decided what is loaded.
    await page.evaluate(SETTLE_SCRIPT, { autoScroll: false });
    const darkCss = await page.evaluate(() => window.__renderlint.hasDarkModeCss()).catch(() => false);
    const schemes = config.colorSchemes === 'auto' ? (darkCss ? ['light', 'dark'] : ['light']) : config.colorSchemes;
    const viewports = config.viewports;
    for (const [si, scheme] of schemes.entries()) {
      if (scheme !== (before.dark ? 'dark' : 'light') || emulated) { await page.emulateMedia({ colorScheme: scheme }); emulated = true; }
      for (const [vi, vp] of viewports.entries()) {
        const issues = [];
        const t0 = Date.now();
        await page.setViewportSize({ width: vp.width, height: vp.height });
        if (await page.evaluate(() => (window.__rlWaitQuiet ? window.__rlWaitQuiet(300, 2) : null)) === null) await page.waitForTimeout(150);
        await page.evaluate(() => { window.__renderlint.finishAnimations(); return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        const res = await page.evaluate((o) => window.__renderlint.analyze(o), analyzeOpts);
        for (const e of res.errors) log('  analyzer error: ' + e);
        const meta = res.meta;
        issues.push(...res.issues);
        const dead = issues.filter((i) => i.needsListenerCheck);
        if (dead.length) await confirmDeadLinks(page, dead, issues);
        const unreachable = issues.filter((i) => i.needsScrollCheck);
        if (unreachable.length) await confirmUnreachable(page, unreachable, issues);
        await page.evaluate(() => { window.scrollTo({ top: 0, behavior: 'instant' }); window.__renderlint.finishAnimations(); });
        if (config.rules.contrast !== 'off') {
          const candidates = await page.evaluate(() => window.__renderlint.collectContrast(true, true));
          issues.push(...await measureContrast(page, candidates, { maxHeight: config.maxScreenshotHeight, level: config.contrastLevel }));
        }
        if (config.rules['dropdown-arrow'] !== 'off') {
          const cands = await page.evaluate(() => window.__renderlint.dropdownCandidates());
          if (cands.length) issues.push(...await measureDropdowns(page, cands));
        }
        if (focus && si === 0 && vi === 0 && config.rules['focus-indicator'] !== 'off') {
          issues.push(...await page.evaluate(() => window.__renderlint.focusCheck(30)));
          await page.evaluate(() => window.__rlWaitQuiet && window.__rlWaitQuiet(500, 2));
        }
        let screenshot = null;
        if (config.screenshots) {
          const visible = issues.filter((i) => i.rect && effectiveSeverity(i, config) !== 'off');
          const errs = visible.filter((i) => effectiveSeverity(i, config) === 'error');
          const shown = errs.length ? errs : visible;
          if (shown.some((i) => !marked.has(groupKey(i)))) {
            screenshot = join(outDir, 'screens', `${slugBase}@${vp.width}${scheme === 'dark' ? '-dark' : ''}.png`);
            shown.forEach((i, n) => { i.marker = n + 1; });
            await annotate(page, shown, config);
            await writeShot(page, screenshot, { x: 0, y: 0, width: meta.width, height: Math.min(config.maxScreenshotHeight, meta.height) });
            await page.evaluate(() => { const o = document.getElementById('__renderlint_overlay'); if (o) o.remove(); });
            for (const i of shown) marked.add(groupKey(i));
          }
        }
        const markedHere = new Set(issues.filter((i) => i.marker).map(groupKey));
        if (config.stress) await stressPasses(page, issues, analyzeOpts, config);
        if (si === 0 && config.sweep.length) {
          const all = config.sweepBreakpoints ? breakpointWidths(config.sweep, await page.evaluate(() => window.__renderlint.breakpoints())) : config.sweep;
          const widths = sweepAssignment(all, viewports).get(vp.width) || [];
          if (widths.length) await sweepPasses(page, { widths, vp, issues, analyzeOpts, config, outDir, url: url + (name ? '#' + name : ''), scheme, marked, markedHere });
        }
        log(`  ${path} @${vp.width}px ${scheme}: ${issues.length} finding(s) in ${Date.now() - t0}ms (in place)`);
        for (const is of issues) out.push({ ...is, page: path, url, viewport: is.sweepWidth || vp.width, scheme, screenshot: is.sweepWidth ? is.screenshot : screenshot, ...(name ? { state: name } : {}) });
      }
    }
  } catch (e) {
    out.push({ rule: 'page-error', severity: 'error', message: 'renderlint could not analyze this page in place: ' + String(e && e.message || e).split('\n')[0], page: path, url });
  } finally {
    // Put the page back the way the test left it.
    await page.evaluate(() => { try { window.__renderlint && window.__renderlint.unstress(); } catch (e) { /* ignore */ } }).catch(() => {});
    if (size) await page.setViewportSize(size).catch(() => {});
    if (emulated) await page.emulateMedia({ colorScheme: before.dark ? 'dark' : 'light' }).catch(() => {});
    await page.evaluate(({ x, y }) => window.scrollTo({ left: x, top: y, behavior: 'instant' }), before).catch(() => {});
  }
  return out;
}
