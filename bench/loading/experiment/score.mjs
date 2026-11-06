// Scores obs.json: one verdict per scenario per detection method, against the ground truth.
//   node score.mjs [obs.json] [--verbose]
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const file = process.argv.find((a) => a.endsWith('.json')) || new URL('./obs.json', import.meta.url).pathname;
const VERBOSE = process.argv.includes('--verbose');
const SHOTS = process.env.SHOTS || new URL('./shots', import.meta.url).pathname;
const obs = JSON.parse(readFileSync(file, 'utf8'));

const inter = (a, b) => a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
// fresh content: items in s2 whose text was not on screen in s1, grouped by the container it went into
function freshGroups(s1, s2) {
  const before = new Map();
  for (const x of [...s1.texts, ...s1.media]) before.set(x.t, (before.get(x.t) || 0) + 1);
  const groups = new Map();
  for (const x of [...s2.texts, ...s2.media, ...s2.blocks.filter((b) => b.f)]) {
    const n = x.t ? before.get(x.t) || 0 : 0;
    if (n) { before.set(x.t, n - 1); continue; }
    const g = groups.get(x.g) || { g: x.g, n: 0, items: [], r: null };
    g.n++; g.items.push(x);
    g.r = g.r ? { x: Math.min(g.r.x, x.r.x), y: Math.min(g.r.y, x.r.y), w: Math.max(g.r.x + g.r.w, x.r.x + x.r.w) - Math.min(g.r.x, x.r.x), h: Math.max(g.r.y + g.r.h, x.r.y + x.r.h) - Math.min(g.r.y, x.r.y) } : { ...x.r };
    groups.set(x.g, g);
  }
  return [...groups.values()];
}
const big = (g, vp) => g.n >= 3 || (g.r.w * g.r.h) >= vp * 0.02;
// pixel "busy cells": share of 16px cells in r with more than one colour that covers 8%
const pngCache = new Map();
function busy(shot, r) {
  if (!pngCache.has(shot)) pngCache.set(shot, PNG.sync.read(readFileSync(`${SHOTS}/${shot}-a.png`)));
  const p = pngCache.get(shot);
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(p.width, r.x + r.w), y1 = Math.min(p.height, r.y + r.h);
  let cells = 0, hot = 0;
  for (let cy = y0; cy < y1; cy += 16) for (let cx = x0; cx < x1; cx += 16) {
    const m = new Map(); let t = 0;
    for (let y = cy; y < Math.min(cy + 16, y1); y++) for (let x = cx; x < Math.min(cx + 16, x1); x++) {
      const i = (y * p.width + x) * 4; const k = (p.data[i] >> 4) << 8 | (p.data[i + 1] >> 4) << 4 | (p.data[i + 2] >> 4);
      m.set(k, (m.get(k) || 0) + 1); t++;
    }
    cells++;
    if ([...m.values()].filter((v) => v >= t * 0.08).length > 1) hot++;
  }
  return cells ? hot / cells : 0;
}

// what each method sees in one held window
function analyse(run) {
  const vp = run.s1.vw * run.s1.vh;
  const groups = freshGroups(run.s1, run.s2).filter((g) => big(g, vp));
  const out = { groups: groups.length, held: run.held.length };
  out.sig = {
    ind: run.s1.ind.map((i) => i.sig),
    motion: run.motion.px > 20,
    jsanim: run.mutsInGap > 3,
  };
  // per region: DOM content present in s1 inside it, and pixel busyness
  const gone = new Set(run.s2.gone || []);
  const placeholders = run.s1.blocks.filter((b, i) => gone.has(i));
  const meta = new Map((run.s2.groups || []).map((x) => [x.id, x]));
  out.regions = groups.map((g) => ({
    r: g.r, n: g.n, into: meta.get(g.g) && meta.get(g.g).s,
    grew: !!(meta.get(g.g) && g.items.some((x) => x.p && meta.get(g.g).prior.includes(x.p))),
    domStuff: [...run.s1.texts, ...run.s1.media, ...placeholders].filter((x) => inter(x.r, g.r)).length,
    domText: [...run.s1.texts, ...run.s1.media].filter((x) => inter(x.r, g.r)).length,
    busy: busy(run.shot, g.r),
  }));
  return out;
}

const METHODS = {
  // DOM only: any loading signal anywhere, or the region where content lands already had content/placeholders
  dom: (a, run) => verdict(a, run, { ind: (s) => s.ind.length > 0 || s.jsanim, region: (r) => r.grew || r.domStuff > 0, fb: (run) => run.mutsAfterClick > 0 }),
  'dom-no-names': (a, run) => verdict(a, run, { ind: (s) => s.ind.filter((x) => x !== 'name').length > 0 || s.jsanim, region: (r) => r.grew || r.domStuff > 0, fb: (run) => run.mutsAfterClick > 0 }),
  'dom-aria-text-only': (a, run) => verdict(a, run, { ind: (s) => s.ind.some((x) => /aria-busy|progressbar|status-text|text|sr-text/.test(x)), region: (r) => r.domText > 0, fb: (run) => run.mutsAfterClick > 0 }),
  // pixels only: something moved on screen, or the region was not empty paint
  px: (a, run) => verdict(a, run, { ind: (s) => s.motion, region: (r) => r.busy > 0.15, fb: (run) => run.diff0 && run.diff0.px > 30 }),
  'dom+motion': (a, run) => verdict(a, run, { ind: (s) => s.ind.length > 0 || s.jsanim || s.motion, region: (r) => r.grew || r.domStuff > 0, fb: (run) => (run.diff0 && run.diff0.px > 30) }),
  combined: (a, run) => verdict(a, run, { ind: (s) => s.ind.length > 0 || s.jsanim || s.motion, region: (r) => r.grew || r.domStuff > 0 || r.busy > 0.15, fb: (run) => (run.diff0 && run.diff0.px > 30) }),
};
// returns 'flag' | 'ok' | 'n/a' (nothing to judge: no request, or the response changed nothing)
function verdict(a, run, m) {
  if (!a.held) return 'n/a';
  const isClick = run.trigger.startsWith('click');
  if (isClick) {
    const after = run.changedAfter.px > 30;
    const during = m.fb(run);
    if (!during && after) return 'flag';           // nothing happened until the data came
    if (!during) return 'n/a';
  }
  if (!a.groups) return isClick ? 'ok' : 'n/a';
  if (m.ind(a.sig)) return 'ok';
  return a.regions.some((r) => !m.region(r)) ? 'flag' : 'ok';
}
const LT = 300;
const freezeVerdict = (run) => (run.longtasks || []).some((t) => t.d >= LT) ? 'flag' : 'ok';

const rows = [];
for (const s of obs) {
  const runs = s.runs.map((run) => ({ run, a: analyse(run) }));
  const res = {};
  for (const [name, fn] of Object.entries(METHODS)) {
    const v = runs.map(({ run, a }) => fn(a, run));
    res[name] = v.includes('flag') ? 'flag' : v.includes('ok') ? 'ok' : 'n/a';
    if (VERBOSE && name === 'combined') for (let i = 0; i < runs.length; i++) console.log(`  ${s.id} ${runs[i].run.trigger} -> ${v[i]}`, JSON.stringify(runs[i].a), 'diff0', runs[i].run.diff0 && runs[i].run.diff0.px, 'after', runs[i].run.changedAfter.px, 'muts', runs[i].run.mutsAfterClick);
  }
  res.freeze = s.runs.some((r) => freezeVerdict(r) === 'flag') ? 'flag' : 'ok';
  res.maxLongtask = Math.max(0, ...s.runs.flatMap((r) => (r.longtasks || []).map((t) => t.d)));
  rows.push({ id: s.id, kind: s.kind, expect: s.expect, ms: s.ms, ...res });
}
const methods = [...Object.keys(METHODS)];
console.log('scenario'.padEnd(28), 'expect', ...methods.map((m) => m.padEnd(10)), 'freeze', 'maxLT');
for (const r of rows) console.log(r.id.padEnd(28), r.expect.padEnd(6), ...methods.map((m) => ((r[m] === 'flag') === (r.expect === 'flag') || r.expect === 'hard' ? ' ' : '✗') + r[m].padEnd(9)), r.freeze.padEnd(6), r.maxLongtask);
console.log('\nmethod       recall   precision  (load/click/route scenarios; "hard" excluded, freeze scenarios scored separately)');
const judged = rows.filter((r) => r.kind !== 'freeze' && r.expect !== 'hard');
for (const m of methods) {
  const tp = judged.filter((r) => r.expect === 'flag' && r[m] === 'flag').length;
  const fn = judged.filter((r) => r.expect === 'flag' && r[m] !== 'flag');
  const fp = judged.filter((r) => r.expect === 'ok' && r[m] === 'flag');
  console.log(m.padEnd(20), `${tp}/${tp + fn.length}`.padEnd(8), `${tp}/${tp + fp.length}`.padEnd(8), fn.length ? 'missed ' + fn.map((r) => r.id).join(',') : '', fp.length ? 'false+ ' + fp.map((r) => r.id).join(',') : '');
}
const fz = rows.filter((r) => r.kind === 'freeze' || r.expect !== 'flag');
console.log(`freeze (longtask >= ${LT}ms): flagged`, rows.filter((r) => r.freeze === 'flag').map((r) => r.id + ' (' + r.maxLongtask + 'ms)').join(', '));
console.log('time per scenario: median', rows.map((r) => r.ms).sort((a, b) => a - b)[rows.length >> 1], 'ms');
