// Loading states: what a page shows while it waits for data. The page's fetch/XHR requests are held
// (as on a slow network), the page is looked at a second into the wait, then they are released and
// the page is looked at again once the data is shown. Content that arrived with the data is grouped
// by the container it went into; a container that showed nothing while waiting, with no loading sign
// anywhere on the page (spinner, skeleton, progress bar, "Loading…" text, aria-busy, motion), is a
// missing loading state. Used by the default pass (page load) and the UX pass (after a click).
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

export const WAIT_MS = 1000;   // how long into the wait we look: past a deliberate spinner delay (~400ms), at the point users notice
const MOTION_GAP = 250;         // a second frame, to see things move (canvas or JS spinners the DOM doesn't name)

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isData = (req) => /^(fetch|xhr)$/.test(req.resourceType());

// One route on the page that can hold, fail or mock its fetch/XHR requests. mode: 'pass' (default),
// 'hold' (keep them until release()), 'fail' (answer HTTP 500), 'empty' (send GET requests, answer
// with their JSON with every list of records emptied: { items: [] }, as for a new account). mockMutations: answer non-GET
// requests with 200 {} instead of sending them, so the UX pass never changes the app's data;
// mockIf(url): also answer these (GET requests to /delete, /logout… URLs).
export async function requestControl(page, { mockMutations = false, mockIf = null } = {}) {
  const ctl = { mode: 'pass', held: [], log: [], mockMutations };
  const answer = async (route, req) => {
    if (ctl.mockMutations && ((req.method() !== 'GET' && req.method() !== 'HEAD') || (mockIf && mockIf(req.url())))) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }).catch(() => {});
    }
    return route.fallback().catch(() => {});
  };
  const handler = async (route) => {
    const req = route.request();
    if (!isData(req)) {
      // a classic <form> POST: never sent while exploring, it would change data
      if (ctl.mockMutations && req.resourceType() === 'document' && req.method() !== 'GET' && req.isNavigationRequest()) {
        return route.fulfill({ status: 204, body: '' }).catch(() => {});
      }
      return route.fallback().catch(() => {});
    }
    const rec = { method: req.method(), url: req.url(), at: Date.now() };
    ctl.log.push(rec);
    if (ctl.mode === 'fail') {
      rec.failed = true;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Internal Server Error"}' }).catch(() => {});
    }
    if (ctl.mode === 'empty' && req.method() === 'GET' && !(mockIf && mockIf(req.url())) && !/event-stream/i.test(req.headers().accept || '')) return emptied(route, rec);
    if (ctl.mode !== 'hold') return answer(route, req);
    ctl.held.push(rec);
    await new Promise((res) => { rec.release = res; if (ctl.mode !== 'hold') res(); });
    return answer(route, req);
  };
  const emptied = async (route, rec) => {
    try {
      const res = await route.fetch({ timeout: 15000 });
      const type = res.headers()['content-type'] || '';
      if (res.ok() && /json/i.test(type)) {
        const [out, n] = emptyLists(JSON.parse(await res.text()));
        if (n) { rec.emptied = n; ctl.emptied.push(rec); return await route.fulfill({ response: res, body: JSON.stringify(out) }); }
      }
      return await route.fulfill({ response: res });
    } catch (e) { return route.fallback().catch(() => {}); }
  };
  ctl.emptied = [];
  await page.route('**/*', handler);
  ctl.dispose = () => { ctl.release(); return page.unroute('**/*', handler).catch(() => {}); };
  ctl.hold = () => { ctl.mode = 'hold'; ctl.held = []; };
  ctl.fail = () => { ctl.mode = 'fail'; };
  ctl.release = () => { ctl.mode = 'pass'; for (const r of ctl.held) if (r.release) r.release(); };
  return ctl;
}

// JSON with every non-empty array of objects (the records a page lists) replaced by [];
// arrays of plain values (roles, tags, chart points) are kept. Returns [json, lists emptied].
// Records have an id (id, _id, uuid, slug, orderId…) or are GraphQL edges; chart points ({ x, y })
// don't, and are left alone, and so is everything under KEEP_KEY (roles, flags, menus…). Counters
// next to an emptied list (total, count, hasMore…) are set to match it.
const ID_KEY = /^(id|_id|uuid|guid|slug|node|cursor)$|(Id|_id|UUID|Uuid)$/;
// lists a new account has too, or that aren't the user's data: who they are and what they may do,
// settings and flags, menus, lookup tables. Emptying them shows a page no user sees ("Access denied").
const KEEP_KEY = /^(roles?|permissions?|scopes?|grants|abilities|capabilities|entitlements|features?|feature_?flags|flags|toggles|experiments|settings|config|preferences|plans?|tiers|locales?|languages?|countries|currencies|timezones|menus?|nav(igation)?|links|routes|breadcrumbs|tabs|columns|fields|options|categories|tags|labels|statuses)$/i;
const COUNT_KEY = /^(total|count|totalCount|total_count|totalItems|total_items|totalResults|total_results|numResults|resultCount|hits|size|length)$/;
const MORE_KEY = /^(hasMore|has_more|hasNextPage|has_next_page|hasNext|more)$/;
const isRecord = (e) => e && typeof e === 'object' && !Array.isArray(e) && Object.keys(e).some((k) => ID_KEY.test(k));
export function emptyLists(v) {
  let n = 0;
  const walk = (x) => {
    if (Array.isArray(x)) {
      if (x.length && x.every(isRecord)) { n++; return []; }
      return x.map(walk);
    }
    if (x && typeof x === 'object') {
      const o = {};
      let emptied = false;
      for (const k of Object.keys(x)) { const before = n; o[k] = KEEP_KEY.test(k) ? x[k] : walk(x[k]); if (n > before && Array.isArray(x[k])) emptied = true; }
      if (emptied) for (const k of Object.keys(o)) {
        if (COUNT_KEY.test(k) && typeof o[k] === 'number') o[k] = 0;
        else if (MORE_KEY.test(k) && typeof o[k] === 'boolean') o[k] = false;
      }
      return o;
    }
    return x;
  };
  const out = walk(v);
  return [out, n];
}

export const viewportPng = async (page) => PNG.sync.read(await page.screenshot({ caret: 'hide', timeout: 10000 }));

// pixels that differ between two screenshots (sum of channel differences > 24)
// skip: boxes to leave out (a field losing its focus ring when the click moves focus)
export function pixelDiff(p, q, skip = []) {
  if (!p || !q || p.width !== q.width || p.height !== q.height) return { px: Infinity, box: null };
  let n = 0, x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const a = p.data, b = q.data;
  for (let i = 0, len = a.length; i < len; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) <= 24) continue;
    const k = i >> 2, x = k % p.width, y = (k / p.width) | 0;
    if (skip.length && skip.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
    n++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { px: n, box: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}

// One look a second into the wait: snapshot, and a second frame for motion. The analyzer must be loaded.
export async function lookWhileWaiting(page) {
  const s1 = await page.evaluate(() => window.__renderlint.waitSnap('mark'));
  const a = await viewportPng(page);
  await sleep(MOTION_GAP);
  const b = await viewportPng(page);
  const mutations = await page.evaluate(() => window.__renderlint.waitMutations()).catch(() => 0);
  return { s1, a, motion: pixelDiff(a, b).px > 20, jsMotion: mutations > 3 };
}
export async function lookAfterData(page) {
  const s2 = await page.evaluate(() => window.__renderlint.waitSnap('group'));
  return { s2, c: await viewportPng(page) };
}

const inter = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const union = (a, b) => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

// Content that is on screen after the data and wasn't while waiting, grouped by the container it went into.
export function freshContent(s1, s2) {
  const before = new Map();
  for (const x of [...s1.texts, ...s1.media]) before.set(x.t, (before.get(x.t) || 0) + 1);
  const groups = new Map();
  const items = [...s2.texts, ...s2.media.filter((m) => m.f || !before.has(m.t)), ...s2.blocks.filter((b) => b.f)];
  for (const x of items) {
    if (x.t) { const n = before.get(x.t) || 0; if (n) { before.set(x.t, n - 1); continue; } }
    const g = groups.get(x.g) || { g: x.g, n: 0, items: [], r: null };
    g.n++; g.items.push(x); g.r = g.r ? union(g.r, x.r) : { ...x.r };
    groups.set(x.g, g);
  }
  const vp = s2.vw * s2.vh;
  // big enough to matter: three or more items, or 2% of the screen (not a notification count)
  return [...groups.values()].filter((g) => g.n >= 3 || g.r.w * g.r.h >= vp * 0.02);
}

// Areas that showed nothing while waiting: no text, image or placeholder block where the content
// later appeared, and not a list that only grew. Empty when a loading sign was anywhere on screen.
export function blankWhileWaiting(look, after) {
  const { s1, motion, jsMotion } = look, { s2 } = after;
  const fresh = freshContent(s1, s2);
  const signs = s1.ind.map((i) => i.sig);
  if (motion) signs.push('motion');
  if (jsMotion) signs.push('js-motion');
  if (!fresh.length || signs.length) return { fresh, signs, blank: [] };
  const gone = new Set(s2.gone || []);
  const placeholders = s1.blocks.filter((b, i) => gone.has(i));
  const meta = new Map((s2.groups || []).map((x) => [x.id, x]));
  const blank = [];
  for (const g of fresh) {
    const m = meta.get(g.g);
    if (m && m.ignored) continue;
    const grew = !!(m && g.items.some((x) => x.p && m.prior.includes(x.p)));
    const there = [...s1.texts, ...s1.media, ...placeholders].some((x) => inter(x.r, g.r));
    if (!grew && !there) blank.push({ rect: g.r, n: g.n, container: m || null, sample: sampleOf(g.items) });
  }
  return { fresh, signs, blank };
}

// a few of the texts that arrived, as the user reads them ("#1040", "Ada Byrne"), for the message
export function sampleOf(items) {
  const out = [];
  for (const x of items) {
    if (!x.t || /^(img|svg|canvas|video|picture|iframe):/.test(x.t)) continue;
    const t = x.e || x.t;
    if (out[out.length - 1] !== t) out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}
export const describeRequests = (reqs, origin) => {
  const list = Array.from(new Set(reqs.map((r) => `${r.method} ${r.url.startsWith(origin) ? r.url.slice(origin.length) : r.url}`)));
  return list.slice(0, 3).join(', ') + (list.length > 3 ? ` and ${list.length - 3} more` : '');
};
export const quoteSample = (sample) => sample.length ? `"${sample.join(' · ').slice(0, 90)}"` : 'the content';

// Side-by-side picture with captions: what the user saw (left) and what came after (right), the
// boxes outlined in red on both. Laid out by the browser (a scratch tab), so the captions are real text.
export async function writeComparison(page, file, left, right, boxes, captions, bad = 0) { // bad: the panel showing the problem (red caption)
  const enc = (img) => 'data:image/png;base64,' + PNG.sync.write(marked(img, boxes)).toString('base64');
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const width = left.width + right.width + 16 + 32;
  const tab = await page.context().newPage();
  try {
    await tab.setViewportSize({ width, height: 200 });
    await tab.setContent(`<style>body{margin:0;background:#fff;font:600 ${Math.max(14, Math.round(left.width / 48))}px/1.3 system-ui,sans-serif;color:#111827}
      .row{display:flex;gap:16px;padding:16px}figure{margin:0}figcaption{padding:0 2px 10px}figure.bad figcaption{color:#be123c}
      img{display:block;border:1px solid #d1d5db}</style><div class="row">` +
      [[left, captions[0]], [right, captions[1]]].map(([img, cap], i) => `<figure${i === bad ? ' class="bad"' : ''}><figcaption>${esc(cap)}</figcaption><img src="${enc(img)}" width="${img.width}" height="${img.height}"></figure>`).join('') + '</div>');
    await tab.screenshot({ path: file, fullPage: true });
  } finally { await tab.close().catch(() => {}); }
  return file;
}
function marked(img, boxes) {
  const out = new PNG({ width: img.width, height: img.height });
  img.data.copy(out.data);
  for (const b of boxes) outline(out, b);
  return out;
}
export function writeMarked(file, img, boxes) {
  writeFileSync(file, PNG.sync.write(marked(img, boxes)));
  return file;
}
function outline(png, r, t = 3) {
  const x0 = Math.max(0, r.x - t), y0 = Math.max(0, r.y - t), x1 = Math.min(png.width - 1, r.x + r.w + t), y1 = Math.min(png.height - 1, r.y + r.h + t);
  const set = (x, y) => { const i = (y * png.width + x) * 4; png.data[i] = 230; png.data[i + 1] = 30; png.data[i + 2] = 60; png.data[i + 3] = 255; };
  for (let x = x0; x <= x1; x++) for (let k = 0; k < t; k++) { if (y0 + k <= y1) set(x, y0 + k); if (y1 - k >= y0) set(x, y1 - k); }
  for (let y = y0; y <= y1; y++) for (let k = 0; k < t; k++) { if (x0 + k <= x1) set(x0 + k, y); if (x1 - k >= x0) set(x1 - k, y); }
}

// The default pass: reload the page with its data requests held and check each area that fills with
// data showed something meanwhile. Returns loading-state findings (warnings). `prepare` reloads the
// analyzer (and anything else the page needs) once the page is there.
export const POOR_CLS = 0.1; // Core Web Vitals: CLS up to 0.1 is "good" (0.25 and over "poor")
const LAYOUT_SHIFT = () => new Promise((resolve) => {
  const entries = [];
  try {
    new PerformanceObserver((l) => entries.push(...l.getEntries())).observe({ type: 'layout-shift', buffered: true });
  } catch (e) { resolve(0); return; }
  setTimeout(() => {
    let worst = 0, sum = 0, first = 0, last = 0;
    for (const e of entries) {
      if (e.hadRecentInput) continue;
      if (sum && (e.startTime - last > 1000 || e.startTime - first > 5000)) sum = 0;
      if (!sum) first = e.startTime;
      sum += e.value; last = e.startTime;
      worst = Math.max(worst, sum);
    }
    resolve(worst);
  }, 50);
});
export async function checkLoadingState(page, { url, timeout = 30000, prepare, waitReady, shotFile, layoutShift = true, log = () => {} }) {
  const ctl = await requestControl(page);
  const origin = new URL(url).origin;
  try {
    ctl.hold();
    await page.goto(url, { waitUntil: 'load', timeout });
    const loaded = Date.now();
    while (!ctl.held.length && Date.now() - loaded < 2500) await sleep(50);
    if (!ctl.held.length) return [];
    const wait = ctl.held[0].at + WAIT_MS - Date.now();
    if (wait > 0) await sleep(wait);
    await page.evaluate(() => window.__rlWaitQuiet && window.__rlWaitQuiet(300, 2)).catch(() => {});
    await prepare();
    const look = await lookWhileWaiting(page);
    const held = ctl.held.slice();
    ctl.release();
    await waitReady();
    const after = await lookAfterData(page);
    const found = [];
    // content jumping as the data arrives (Core Web Vitals CLS: worst 5s window of shifts less than 1s apart)
    const cls = await page.evaluate(LAYOUT_SHIFT).catch(() => 0);
    if (process.env.RENDERLINT_DEBUG) log(`    loading: held ${held.length}, CLS ${cls.toFixed(3)}`);
    if (layoutShift && cls > POOR_CLS) {
      found.push({ rule: 'layout-shift', severity: 'warn', selector: 'body',
        message: `Content jumps when this page's data arrives (Cumulative Layout Shift ${cls.toFixed(2)} with the data ${WAIT_MS / 1000}s late; Core Web Vitals wants 0.1 or less): text and buttons move, so users lose their place or click the wrong thing. Reserve the space first: a skeleton the size of the content that is coming, min-height on areas filled by data, width and height (or aspect-ratio) on images, and no banners inserted above content already shown.`,
        details: { cls: +cls.toFixed(3), requests: held.map((r) => r.method + ' ' + r.url) } });
    }
    const { blank } = blankWhileWaiting(look, after);
    if (!blank.length) return found;
    const reqs = describeRequests(held, origin);
    const shot = shotFile ? await writeComparison(page, shotFile, look.a, after.c, blank.map((b) => b.rect), [`Waiting ${WAIT_MS / 1000}s for ${reqs}: nothing shown`, 'After the data arrived']).catch(() => undefined) : undefined;
    return found.concat(blank.map((b) => {
      const where = b.container ? b.container.selector : 'the page';
      return {
        rule: 'loading-state', severity: 'warn',
        message: `While this page waited for its data (${reqs}; renderlint held it ${WAIT_MS / 1000}s, as on a slow network), the area where ${quoteSample(b.sample)} appears showed nothing: no spinner, skeleton, progress bar or "Loading…" text. On a slow connection the page looks empty or frozen. Render a loading state in ${where} until the data arrives (a skeleton shaped like the content, or a spinner), and an error message if the request fails.`,
        selector: b.container ? b.container.selector : 'body', text: b.container ? b.container.text : '', source: b.container ? b.container.source : undefined,
        rect: b.rect, screenshot: shot, ownShot: !!shot,
        details: { requests: held.map((r) => r.method + ' ' + r.url), waitedMs: WAIT_MS, area: b.rect, sample: b.sample },
      };
    }));
  } catch (e) {
    log('  loading-state check skipped on ' + url + ': ' + String(e && e.message || e).split('\n')[0]);
    return [];
  } finally {
    await ctl.dispose();
  }
}
