// The UX pass (--ux, or "ux": true): uses the page the way a user would and reports where it feels
// broken. On a fresh load for each action (button, tab, in-app link, form submit with test data):
//   action-feedback  the action started a request and nothing on screen changed for a second
//   loading-state    the area it fills stayed blank meanwhile (as on page load)
//   ui-freeze        the page could not respond or repaint for 500ms or more (a long task)
//   double-submit    a second click while the first was pending sent the request again
//   error-feedback   the request failed (renderlint answers HTTP 500) and nothing told the user
//   dead-control     a button that does nothing at all
// And for the page: slow-render (largest content later than 4s), ui-freeze while loading,
// error-feedback when its data fails to load.
// Requests that change data (POST, PUT, PATCH, DELETE) are answered by renderlint with 200 {} and
// never reach the server, unless "ux": { "mutations": "allow" }.
import { requestControl, lookWhileWaiting, lookAfterData, blankWhileWaiting, freshContent, pixelDiff, viewportPng, describeRequests, quoteSample, sampleOf, writeComparison, writeMarked, WAIT_MS } from './waiting.js';
import { looksDestructive } from './runner.js';

export const FREEZE_MS = 500;      // a click answered later than this reads as a hang (INP "poor" starts at 500ms)
export const SLOW_LCP_MS = 4000;   // Core Web Vitals: LCP over 4s is "poor"

// Installed on the page in UX mode: long tasks, interaction latency (Event Timing), LCP, layout shifts.
export const UX_PERF = () => {
  if (window.__rlUx) return;
  const ux = (window.__rlUx = { longtasks: [], events: [], lcp: 0, cls: 0, errors: [] });
  const watch = (type, fn, extra) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...(extra || {}) }); } catch (e) { /* unsupported */ } };
  watch('longtask', (e) => ux.longtasks.push({ start: e.startTime, d: e.duration }));
  watch('event', (e) => { if (e.interactionId) ux.events.push({ name: e.name, start: e.startTime, d: e.duration }); }, { durationThreshold: 16 });
  watch('largest-contentful-paint', (e) => { ux.lcp = e.startTime; });
  watch('layout-shift', (e) => { if (!e.hadRecentInput) ux.cls += e.value; });
  addEventListener('unhandledrejection', (e) => { ux.errors.push({ at: performance.now(), msg: 'Unhandled promise rejection: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 160) }); });
  addEventListener('error', (e) => { ux.errors.push({ at: performance.now(), msg: 'Uncaught error: ' + String(e.message).slice(0, 160) }); });
};

// actions where a second click is a mistake, not a second like or a second item
const SUBMIT_LABEL = /\b(save|submit|send|pay|purchase|checkout|check out|place order|order now|confirm|create|register|sign ?up|book|publish|post|apply|transfer|donate|subscribe|invite|upload)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1).replace(/\.0$/, '') + 's';
const today = () => new Date().toISOString().slice(0, 10);

// Test data for a form field, from its type, name, label and autocomplete.
export function testValue(f) {
  const k = `${f.type} ${f.name} ${f.label} ${f.autocomplete}`.toLowerCase();
  const fit = (v) => (f.minLength && v.length < f.minLength ? v + 'x'.repeat(f.minLength - v.length) : v);
  if (f.type === 'email' || /e-?mail/.test(k)) return 'test.user@example.com';
  if (f.type === 'password' || /pass(word)?/.test(k)) return fit('Test-passw0rd!');
  if (f.type === 'tel' || /phone|mobile|\btel\b/.test(k)) return '+15550100100';
  if (f.type === 'url' || /\burl\b|website|homepage/.test(k)) return 'https://example.com';
  if (f.type === 'number' || f.type === 'range') return String(f.min != null && f.min !== '' ? f.min : f.max != null && f.max !== '' && +f.max < 1 ? f.max : 1);
  if (f.type === 'date') return f.min || today();
  if (f.type === 'datetime-local') return (f.min || today() + 'T10:00').slice(0, 16);
  if (f.type === 'time') return '10:00';
  if (f.type === 'month') return today().slice(0, 7);
  if (f.type === 'week') return today().slice(0, 4) + '-W10';
  if (f.type === 'color') return '#3366cc';
  if (/zip|postal/.test(k)) return '94105';
  if (/\bcity\b/.test(k)) return 'Springfield';
  if (/country/.test(k)) return 'United States';
  if (/(first|given).?name/.test(k)) return 'Test';
  if (/(last|family|sur).?name/.test(k)) return 'User';
  if (/\bname\b|full.?name/.test(k)) return 'Test User';
  if (/company|organi[sz]ation/.test(k)) return 'Example Inc';
  if (/search|query|\bq\b|filter/.test(k)) return 'test';
  if (/amount|price|qty|quantity/.test(k)) return '1';
  if (f.tag === 'textarea' || /message|comment|description|note|bio/.test(k)) return fit('This is a test message.');
  return fit('Test');
}

async function fillForm(page) {
  const fields = await page.evaluate(() => window.__renderlint.uxFields()).catch(() => []);
  for (const f of fields) {
    const sel = `[data-rl-ux-field="${f.i}"]`;
    try {
      if (f.tag === 'select') { const opts = await page.$$eval(sel + ' option', (o) => o.filter((x) => !x.disabled && x.value).map((x) => x.value)); if (opts.length) await page.selectOption(sel, opts[0], { timeout: 1000 }); }
      else if (f.type === 'checkbox') { if (f.required && !f.checked) await page.check(sel, { timeout: 1000 }); }
      else if (f.type === 'radio') { if (f.required) await page.check(sel, { timeout: 1000 }); }
      else if (!f.filled) await page.fill(sel, testValue(f), { timeout: 1000 });
    } catch { /* a field that won't take the value: leave it */ }
  }
  return fields.length;
}

export async function uxPass(page, { url, config, source, waitReady, log = () => {}, shotBase = null }) {
  const opt = { maxActions: 12, mutations: 'mock', ...(typeof config.ux === 'object' && config.ux ? config.ux : {}) };
  const on = (rule) => config.rules[rule] !== 'off';
  const origin = new URL(url).origin;
  const issues = [];
  let shots = 0;
  const shotFile = () => (shotBase ? `${shotBase}${++shots}.png` : null);
  const ctl = await requestControl(page, { mockMutations: opt.mutations !== 'allow' });
  const fresh = async () => {
    ctl.mode = 'pass';
    await page.goto(url, { waitUntil: 'load', timeout: config.timeout });
    await waitReady();
    await page.evaluate(source);
  };
  try {
    // ---- the page: a warm reload, as a returning user gets it
    ctl.log.length = 0;
    await fresh();
    // the main content can come with data that takes a while: wait for it (bounded) before reading LCP
    await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
    const loadData = ctl.log.filter((r) => r.method === 'GET').slice();
    const perf = await page.evaluate(() => window.__rlUx && { lcp: window.__rlUx.lcp, cls: window.__rlUx.cls, longtasks: window.__rlUx.longtasks }).catch(() => null);
    if (perf) {
      if (on('slow-render') && perf.lcp > SLOW_LCP_MS) {
        issues.push({ rule: 'slow-render', severity: 'warn', selector: 'body',
          message: `The page's main content appeared only after ${secs(perf.lcp)} (Largest Contentful Paint, on a reload from the local server, with the browser cache warm). Over 4s is rated poor and users start leaving after about 3s. Find what holds it back: a request waterfall (one request waiting for another), a large script bundle loaded before anything renders (split it, load routes lazily), or data fetched in the browser that the server could send with the page.`,
          details: { lcpMs: Math.round(perf.lcp) } });
      }
      const long = perf.longtasks.filter((t) => t.d >= FREEZE_MS).sort((a, b) => b.d - a.d)[0];
      if (on('ui-freeze') && long) {
        issues.push({ rule: 'ui-freeze', severity: 'warn', selector: 'body',
          message: `While loading, the page froze for ${secs(long.d)} (one task blocked the main thread from ${secs(long.start)}): no click, scroll or typing gets a response meanwhile. Find the work in the Performance panel and split it up: render long lists virtualized or in pages, move heavy computation to a Web Worker, or yield between chunks (await scheduler.yield() / setTimeout).`,
          details: { blockedMs: Math.round(long.d), atMs: Math.round(long.start) } });
      }
    }
    const normal = await page.evaluate(() => window.__renderlint.waitSnap()).catch(() => null);
    const normalShot = await viewportPng(page).catch(() => null);

    // ---- the page's data fails to load
    if (on('error-feedback') && loadData.length && normal) {
      ctl.fail();
      await page.goto(url, { waitUntil: 'load', timeout: config.timeout });
      await waitReady();
      await page.evaluate(source);
      const failed = await page.evaluate(() => window.__renderlint.waitSnap()).catch(() => null);
      const told = await page.evaluate(() => window.__renderlint.errorShown()).catch(() => []);
      ctl.mode = 'pass';
      const missing = failed ? freshContent(failed, normal) : [];
      if (failed && !told.length && missing.length) {
        const stuck = failed.ind.length > 0;
        const shot = shotFile();
        if (shot && normalShot) await writeComparison(page, shot, await viewportPng(page), normalShot, missing.map((g) => g.r), [`${describeRequests(loadData, origin)} failed (HTTP 500): ${stuck ? 'still loading' : 'no error shown'}`, 'When the data loads']).catch(() => {});
        issues.push({ rule: 'error-feedback', severity: 'warn', selector: 'body', rect: missing[0].r, ...(shot ? { screenshot: shot, ownShot: true } : {}),
          message: `When the page's data fails to load (renderlint answered ${describeRequests(loadData, origin)} with HTTP 500), ${stuck ? 'it keeps showing its loading state forever' : 'the page just shows less'}, and nothing says something went wrong: the area with ${quoteSample(sampleOf(missing[0].items))} is ${stuck ? 'still loading' : 'missing'}. Handle the failed request: show an error message where the content would be, with a "Try again" button (TanStack Query isError / error boundaries / a catch that sets error state).`,
          details: { requests: loadData.map((r) => r.method + ' ' + r.url), stuck } });
      }
    }

    // ---- the actions on the page
    await fresh();
    const actions = await page.evaluate((m) => window.__renderlint.uxActions(m), opt.maxActions).catch(() => []);
    log(`  ux: ${actions.length} action(s) on ${url.replace(origin, '') || '/'}`);
    for (const act of actions) {
      if (act.href && looksDestructive(act.href)) continue;
      try { await checkAction(act); } catch (e) { log(`  ux: skipped "${act.label}": ${String(e && e.message || e).split('\n')[0]}`); }
    }
  } finally {
    await ctl.dispose();
  }
  return issues;

  // Clicks one action on a fresh load, holding the requests it starts, and judges what the user sees.
  async function checkAction(act) {
    await fresh();
    let at = await page.evaluate((k) => window.__renderlint.uxMark(k), act.key);
    if (!at) return;
    const filled = act.kind === 'submit' ? await fillForm(page) : 0;
    if (act.kind === 'submit' && !(await page.evaluate(() => window.__renderlint.uxFormValid()))) return; // the browser's own validation stops it
    at = await page.evaluate((k) => window.__renderlint.uxMark(k), act.key) || at;
    const el = page.locator('[data-rl-ux="1"]').first();
    await el.hover({ timeout: 1000 }).catch(() => {});
    await sleep(120);
    const s0 = await page.evaluate(() => window.__renderlint.waitSnap());
    // the field focused now loses its focus ring when the click moves focus: not a response
    const focusBox = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body || a.hasAttribute('data-rl-ux')) return null;
      const r = a.getBoundingClientRect();
      return { x: Math.floor(r.left) - 8, y: Math.floor(r.top) - 8, w: Math.ceil(r.width) + 16, h: Math.ceil(r.height) + 16 };
    }).catch(() => null);
    const skip = focusBox ? [focusBox] : [];
    const z = await viewportPng(page);
    const told0 = await page.evaluate(() => window.__renderlint.errorShown()).catch(() => []);
    const t0 = await page.evaluate(() => performance.now());
    const startUrl = page.url();
    let reacted = '';
    const onDoc = (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) reacted = reacted || 'navigation'; };
    const onDialog = () => { reacted = reacted || 'dialog'; };
    const onPopup = () => { reacted = reacted || 'popup'; };
    const onDownload = () => { reacted = reacted || 'download'; };
    page.on('request', onDoc); page.on('dialog', onDialog); page.on('popup', onPopup); page.on('download', onDownload);
    const what = `${act.kind === 'link' ? 'the link' : act.kind === 'tab' ? 'the tab' : 'the button'} "${act.label || at.selector}"${filled ? ' (form filled with test data)' : ''}`;
    try {
      ctl.hold();
      const clickAt = Date.now();
      await el.click({ timeout: 2000, noWaitAfter: true });
      // double submit: a second click while a request that changes data is pending
      let doubled = null;
      await sleep(150);
      const writes = () => ctl.held.filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
      if (on('double-submit') && (act.kind === 'submit' || SUBMIT_LABEL.test(act.label)) && writes().length && !reacted) {
        const first = writes().length;
        await el.click({ timeout: 300, noWaitAfter: true }).catch(() => {});
        await sleep(200);
        const again = writes();
        if (again.length > first) doubled = again[0];
      }
      const left = clickAt + WAIT_MS - Date.now();
      if (left > 0) await sleep(left);
      if (reacted === 'navigation' || page.url() !== startUrl && !(await sameDocument(page))) { ctl.release(); return; }
      const look = await lookWhileWaiting(page);
      const held = ctl.held.slice();
      ctl.release();
      await waitReady();
      const after = await lookAfterData(page);
      const perf = await page.evaluate((t) => ({
        events: window.__rlUx ? window.__rlUx.events.filter((e) => e.start >= t - 5) : [],
        longtasks: window.__rlUx ? window.__rlUx.longtasks.filter((e) => e.start >= t - 5) : [],
      }), t0).catch(() => ({ events: [], longtasks: [] }));
      const rect = at.rect;
      const base = { selector: at.selector, text: at.text, source: at.source, rect };

      // ui-freeze: the click wasn't answered with a frame for FREEZE_MS
      const worst = Math.max(0, ...perf.events.map((e) => e.d), ...perf.longtasks.map((e) => e.d));
      if (on('ui-freeze') && worst >= FREEZE_MS) {
        issues.push({ rule: 'ui-freeze', severity: 'warn', ...base,
          message: `Clicking ${what} froze the page for ${secs(worst)}: the main thread was busy, so nothing could respond or repaint (over 500ms reads as a hang; Interaction to Next Paint over 500ms is rated poor). Find the work in the Performance panel and move it off the click: a Web Worker for heavy computation, chunks that yield (await scheduler.yield() / setTimeout), a virtualized list instead of rendering thousands of rows, or startTransition so React can paint feedback first.`,
          details: { blockedMs: Math.round(worst), action: act.label } });
      }
      if (doubled) {
        issues.push({ rule: 'double-submit', severity: 'warn', ...base,
          message: `Clicking ${what} twice while the first request was still pending sent ${doubled.method} ${doubled.url.replace(origin, '')} twice: an impatient user creates duplicates (two orders, two payments, two messages). Disable the button (or ignore clicks) while the request is in flight, and show that it is working ("Saving…").`,
          details: { request: doubled.method + ' ' + doubled.url, action: act.label } });
      }
      const textsOf = (sn) => sn.texts.map((x) => x.t).join('\n');
      const during = pixelDiff(z, look.a, skip).px > 30 || textsOf(s0) !== textsOf(look.s1) || look.s1.ind.length > s0.ind.length;
      const changedAfter = pixelDiff(look.a, after.c).px > 30;
      if (held.length) {
        const reqs = describeRequests(held, origin);
        if (!during && changedAfter && !reacted && on('action-feedback')) {
          const shot = shotFile();
          if (shot) await writeComparison(page, shot, z, look.a, [at.vrect], [`Before clicking "${act.label}"`, `${secs(WAIT_MS)} after the click: nothing changed`], 1).catch(() => {});
          issues.push({ rule: 'action-feedback', severity: 'warn', ...base, ...(shot ? { screenshot: shot, ownShot: true } : {}),
            message: `After clicking ${what}, nothing on screen changed for ${secs(WAIT_MS)} while ${reqs} was loading (renderlint held it, as on a slow network): the page looks frozen and users click again or leave. Respond at once: show the pending state on the control (spinner, "Saving…", disabled) or where the result will appear (skeleton, dimmed old content, a top progress bar for page changes), then the result.`,
            details: { requests: held.map((r) => r.method + ' ' + r.url), waitedMs: WAIT_MS, action: act.label } });
        } else if (during && on('loading-state')) {
          const { blank } = blankWhileWaiting(look, after);
          const shot = blank.length ? shotFile() : null;
          if (shot) await writeComparison(page, shot, look.a, after.c, blank.map((b) => b.rect), [`${secs(WAIT_MS)} after clicking "${act.label}": nothing shown`, 'After the data arrived']).catch(() => {});
          for (const b of blank) {
            issues.push({ rule: 'loading-state', severity: 'warn', selector: b.container ? b.container.selector : at.selector, text: b.container ? b.container.text : '', source: b.container ? b.container.source : at.source, rect: b.rect, ...(shot ? { screenshot: shot, ownShot: true } : {}),
              message: `After clicking ${what}, the area where ${quoteSample(b.sample)} appears stayed empty while ${reqs} was loading (held ${secs(WAIT_MS)}, as on a slow network): no spinner, skeleton or "Loading…" text. Render a loading state there until the data arrives.`,
              details: { requests: held.map((r) => r.method + ' ' + r.url), action: act.label, area: b.rect, sample: b.sample } });
          }
        }
        if (changedAfter && on('error-feedback')) await checkActionFailure(act, what, base, held, told0);
      } else if (!reacted && act.kind !== 'link' && on('dead-control') && page.url() === startUrl && pixelDiff(z, after.c, skip).px <= 30 && pixelDiff(z, look.a, skip).px <= 30) {
        const shot = shotFile();
        if (shot) writeMarked(shot, z, [at.vrect]);
        issues.push({ rule: 'dead-control', severity: 'warn', ...base, ...(shot ? { screenshot: shot, ownShot: true } : {}),
          message: `Clicking ${what} does nothing a user can see: no request, no change on screen, no navigation. Either it is broken (a missing or failing handler, a handler on the wrong element) or its result is invisible (copied to the clipboard, saved in the background): then confirm it ("Copied", a toast). If it is a placeholder, disable it or remove it.`,
          details: { action: act.label } });
      }
    } finally {
      page.off('request', onDoc); page.off('dialog', onDialog); page.off('popup', onPopup); page.off('download', onDownload);
    }
  }

  // The same action with its requests failing: does the page say so?
  async function checkActionFailure(act, what, base, held, told0) {
    await fresh();
    if (!(await page.evaluate((k) => window.__renderlint.uxMark(k), act.key))) return;
    if (act.kind === 'submit') await fillForm(page);
    await page.evaluate((k) => window.__renderlint.uxMark(k), act.key);
    const before = await viewportPng(page);
    const t0 = await page.evaluate(() => performance.now());
    ctl.fail();
    await page.locator('[data-rl-ux="1"]').first().click({ timeout: 2000, noWaitAfter: true }).catch(() => {});
    await sleep(300);
    await waitReady();
    ctl.mode = 'pass';
    const snap = await page.evaluate(() => window.__renderlint.waitSnap()).catch(() => null);
    const told = await page.evaluate(() => window.__renderlint.errorShown()).catch(() => []);
    if (!snap || told.some((t) => !told0.includes(t))) return;
    const errs = await page.evaluate((t) => (window.__rlUx ? window.__rlUx.errors.filter((e) => e.at >= t).map((e) => e.msg) : []), t0).catch(() => []);
    const stuck = snap.ind.length > 0;
    const shot = shotFile();
    if (shot) await writeComparison(page, shot, before, await viewportPng(page), [base.rect && { ...base.rect, y: base.rect.y - (await page.evaluate(() => scrollY)) }].filter(Boolean), [`Before clicking "${act.label}"`, `${reqs} failed (HTTP 500): ${stuck ? 'still loading' : 'no error shown'}`], 1).catch(() => {});
    const reqs = describeRequests(held, origin);
    issues.push({ rule: 'error-feedback', severity: 'warn', ...base, ...(shot ? { screenshot: shot, ownShot: true } : {}),
      message: `When ${reqs} fails after clicking ${what} (renderlint answered HTTP 500), ${stuck ? 'the page keeps showing its loading state forever' : 'nothing on the page says so'}: the user thinks it worked, or waits. Catch the failure and show it: an inline error or a toast with what went wrong and a way to retry, and re-enable the control.${errs.length ? ` The failure is also unhandled in the code: ${errs[0]}.` : ''}`,
      details: { requests: held.map((r) => r.method + ' ' + r.url), action: act.label, stuck, ...(errs.length ? { unhandled: errs } : {}) } });
  }
}

async function sameDocument(page) {
  // a client-side route change keeps the document (and the UX_PERF state on it)
  return page.evaluate(() => !!window.__rlUx).catch(() => false);
}
