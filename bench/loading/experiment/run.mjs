// Loading-state experiment: hold the page's API requests, look at what it shows meanwhile,
// release them, look again. Records raw observations per scenario into obs.json; score.mjs
// turns them into verdicts per detection method.
//   node run.mjs [--obs 1000] [--only id,id] [--out obs.json]
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => (x.startsWith('--') ? [...a, [x.slice(2), all[i + 1]]] : a), []));
const BASE = args.base || 'http://localhost:5393';
const OBS = Number(args.obs || 1000);       // ms after the trigger when we look
const GAP = 250;                            // second frame, to see motion
const PROBE = readFileSync(new URL('./probe-page.js', import.meta.url), 'utf8');
const scen = JSON.parse(readFileSync(args.scenarios || new URL('../app/scenarios.json', import.meta.url).pathname, 'utf8'))
  .filter((s) => !args.only || args.only.split(',').includes(s.id));
const SHOTS = args.shots || new URL('./shots', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  const hold = { on: false, held: [], seen: [] };
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    if (!/^(fetch|xhr)$/.test(req.resourceType())) return route.continue();
    const rec = { m: req.method(), u: req.url().replace(BASE, ''), t: Date.now() };
    hold.seen.push(rec);
    if (!hold.on) return route.continue();
    hold.held.push(rec);
    await new Promise((res) => { rec.release = res; if (!hold.on) res(); });
    await route.continue().catch(() => {});
  });
  hold.release = () => { hold.on = false; for (const r of hold.held) r.release && r.release(); };
  return { ctx, page, hold };
}
const png = async (page) => PNG.sync.read(await page.screenshot());
// network quiet for 300ms and DOM quiet for 300ms, at most 4s
async function settle(page, hold, max = 4000) {
  const end = Date.now() + max;
  let last = -1;
  while (Date.now() < end) {
    await sleep(150);
    const n = hold.seen.length + (await page.evaluate(() => window.__lb.muts.length).catch(() => 0));
    if (n === last) { await sleep(150); const n2 = hold.seen.length + (await page.evaluate(() => window.__lb.muts.length).catch(() => 0)); if (n2 === n) return; }
    last = n;
  }
}
const snap = (page, mode) => page.evaluate((m) => window.__lb.snap(m), mode);
const now = (page) => page.evaluate(() => window.__lb.now());

// what the page shows OBS ms after `trigger` while every API request it makes is held
async function window_(page, hold, trigger) {
  hold.on = true; hold.held.length = 0;
  const t0 = Date.now();
  const pt0 = await trigger();
  const wait = OBS - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  const tObs = Date.now() - t0;
  const pObs = await now(page);
  const s1 = await snap(page, 'mark'), a = await png(page);
  await sleep(GAP);
  const b = await png(page);
  const m = await page.evaluate(([from, to]) => window.__lb.muts.filter((x) => x.t >= from && x.t <= to).length, [pObs, pObs + GAP + 50]);
  const held = hold.held.map(({ m, u, t }) => ({ m, u, at: t - t0 }));
  hold.release();
  await settle(page, hold);
  const s2 = await snap(page, 'group'), c = await png(page);
  return { s1, s2, a, b, c, held, tObs, mutsInGap: m, pt0 };
}

const out = [];
for (const s of scen) {
  const url = BASE + (s.url || '/s/' + s.id);
  const t = Date.now();
  const rec = { id: s.id, kind: s.kind, expect: s.expect, runs: [] };
  try {
    // 1. page load with the API held
    {
      const { ctx, page, hold } = await newPage();
      const w = await window_(page, hold, async () => { await page.goto(url, { waitUntil: 'load' }); });
      const lt = await page.evaluate(() => window.__lb.longtasks);
      rec.runs.push({ trigger: 'load', ...pack(w, s.id + '-load'), longtasks: lt });
      // 2. clicks: every button / tab / same-origin link, each on a freshly loaded page
      const targets = await page.evaluate(() => [...document.querySelectorAll('button, [role=tab], [role=button], a[href]')]
        .filter((e) => e.checkVisibility() && (e.tagName !== 'A' || (new URL(e.href, location.href).origin === location.origin && e.href !== location.href)))
        .map((e) => [...document.querySelectorAll('button, [role=tab], [role=button], a[href]')].indexOf(e) + '|' + (e.textContent || '').trim()).slice(0, 4));
      await ctx.close();
      for (const tgt of targets) {
        const [idx, label] = [Number(tgt.split('|')[0]), tgt.slice(tgt.indexOf('|') + 1)];
        const { ctx, page, hold } = await newPage();
        await page.goto(url, { waitUntil: 'load' });
        await settle(page, hold);
        const el = page.locator('button, [role=tab], [role=button], a[href]').nth(idx);
        await el.hover().catch(() => {});
        await sleep(120);
        const s0 = await snap(page), z = await png(page);
        const lt0 = (await page.evaluate(() => window.__lb.longtasks.length));
        const tc = await now(page);
        const w = await window_(page, hold, async () => { await el.click({ timeout: 3000, noWaitAfter: true }).catch((e) => console.error(s.id, label, e.message)); });
        const muts = await page.evaluate((t) => window.__lb.muts.filter((m) => m.t >= t && m.t <= t + 1000).length, tc);
        const lt = (await page.evaluate(() => window.__lb.longtasks)).slice(lt0);
        rec.runs.push({ trigger: 'click:' + label, s0, z: pxStats(z), ...pack(w, s.id + '-' + label.replace(/\W+/g, '')), longtasks: lt, mutsAfterClick: muts, diff0: diff(z, w.a) });
        await ctx.close();
      }
    }
  } catch (e) { rec.error = e.message; console.error(s.id, e.message); }
  rec.ms = Date.now() - t;
  out.push(rec);
  console.log(s.id.padEnd(28), rec.runs.map((r) => `${r.trigger}[held ${r.held.length}]`).join(' '), rec.ms + 'ms');
}
await browser.close();
writeFileSync(args.out || new URL('./obs.json', import.meta.url).pathname, JSON.stringify(out));

// pixel facts, so scoring needs no images: motion between a and b; per-region uniformity is
// computed for the regions that matter (new content boxes) here, while we still have pixels
function pack(w, name) {
  writeFileSync(`${SHOTS}/${name}-a.png`, PNG.sync.write(w.a));
  writeFileSync(`${SHOTS}/${name}-c.png`, PNG.sync.write(w.c));
  const motion = diff(w.a, w.b);
  return { shot: name, s1: w.s1, s2: w.s2, held: w.held, tObs: w.tObs, mutsInGap: w.mutsInGap, motion, changedAfter: diff(w.a, w.c) };
}
function newContentBoxes(s1, s2) {
  const before = new Map();
  for (const x of [...s1.texts, ...s1.media]) before.set(x.t, (before.get(x.t) || 0) + 1);
  const fresh = [];
  for (const x of [...s2.texts, ...s2.media]) { const n = before.get(x.t) || 0; if (n) before.set(x.t, n - 1); else fresh.push(x.r); }
  if (!fresh.length) return [];
  // one union box per cluster of nearby fresh items
  const clusters = [];
  for (const r of fresh) {
    const c = clusters.find((c) => r.x < c.x + c.w + 60 && r.x + r.w > c.x - 60 && r.y < c.y + c.h + 60 && r.y + r.h > c.y - 60);
    if (c) { const x = Math.min(c.x, r.x), y = Math.min(c.y, r.y); c.w = Math.max(c.x + c.w, r.x + r.w) - x; c.h = Math.max(c.y + c.h, r.y + r.h) - y; c.x = x; c.y = y; c.n++; }
    else clusters.push({ ...r, n: 1 });
  }
  return clusters;
}
function diff(p, q) {
  if (p.width !== q.width || p.height !== q.height) return { ratio: 1, box: null };
  let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    const i = (y * p.width + x) * 4;
    if (Math.abs(p.data[i] - q.data[i]) + Math.abs(p.data[i + 1] - q.data[i + 1]) + Math.abs(p.data[i + 2] - q.data[i + 2]) > 24) { n++; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  }
  return { ratio: n / (p.width * p.height), px: n, box: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}
function uniform(p, r) {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(p.width, r.x + r.w), y1 = Math.min(p.height, r.y + r.h);
  const counts = new Map(); let total = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.width + x) * 4;
    const k = (p.data[i] >> 3) << 10 | (p.data[i + 1] >> 3) << 5 | (p.data[i + 2] >> 3);
    counts.set(k, (counts.get(k) || 0) + 1); total++;
  }
  return total ? Math.max(...counts.values()) / total : 1;
}
function pxStats() { return null; }
