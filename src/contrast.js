// Contrast measurement. Text on a background the analyzer proves flat (an opaque colour,
// nothing painted over it, no effect changing it: see src/analyzer/solid-bg.js) is computed
// from its colours. Everything else is measured on screenshots: the page is captured twice,
// once as rendered and once with all text glyphs made transparent (text-fill-color, so
// currentColor icons and shapes stay painted). Pixels under each text run in the second
// capture are the *real* background (gradients, images, overlays, translucent layers
// included). Only the box around the text that needs pixels is captured.
import { appendFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { blend, hex, luminance, suggestColor } from './color.js';

const HIDE_TEXT_CSS = `
*, *::before, *::after { -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important;
  transition: none !important; }
::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }
svg text, svg tspan, svg textPath { fill: transparent !important; stroke: transparent !important; }
[data-rl-cx] { background-image: none !important; }
`;

// sRGB channel -> linear lookup table (avoids Math.pow per pixel)
const LIN = new Float64Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; LIN[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
const lumOf = (r, g, b) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
const ratioOf = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

// Sample points over the rects (clamped to the page's width × height), as byte offsets into
// img, a capture of the page box { x, y, width } (without img: only how many there are).
function samplePoints(rects, width, height, img, maxPoints = 300) {
  const pts = [];
  const area = rects.reduce((s, r) => s + r.w * r.h, 0) || 1;
  const step = Math.max(1, Math.sqrt(area / maxPoints));
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width - 1, Math.ceil(r.x + r.w) - 1), y1 = Math.min(height - 1, Math.ceil(r.y + r.h) - 1);
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) pts.push(img ? ((Math.round(y) - img.y) * img.width + Math.round(x) - img.x) << 2 : 0);
  }
  return pts;
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }

// Integer page box around rects, clamped to width × height; null when empty.
function boundsOf(rects, width, height) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, Math.floor(r.x)); y0 = Math.min(y0, Math.floor(r.y));
    x1 = Math.max(x1, Math.ceil(r.x + r.w)); y1 = Math.max(y1, Math.ceil(r.y + r.h));
  }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(width, x1); y1 = Math.min(height, y1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

// Groups candidates into capture boxes: two boxes are merged when the area their union adds
// costs less than another capture (a capture costs about as much as ~400k pixels of area).
const CAPTURE_COST = 400000;
function clusters(cands, width, height) {
  let groups = cands.map((c) => { const b = boundsOf(c.rects, width, height); return b && { x: b.x, y: b.y, r: b.x + b.width, b: b.y + b.height, members: [c] }; }).filter(Boolean);
  const area = (g) => (g.r - g.x) * (g.b - g.y);
  const union = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) });
  // a pass in reading order first (cheap), then the best pairs
  groups.sort((a, b) => a.y - b.y || a.x - b.x);
  const swept = [];
  for (const g of groups) {
    const last = swept[swept.length - 1];
    if (last && area(union(last, g)) - area(last) - area(g) < CAPTURE_COST) swept[swept.length - 1] = { ...union(last, g), members: last.members.concat(g.members) };
    else swept.push(g);
  }
  groups = swept;
  if (groups.length > 150) groups = [groups.reduce((a, g) => ({ ...union(a, g), members: a.members.concat(g.members) }))];
  for (let merged = true; merged && groups.length > 1;) {
    merged = false;
    let best = null;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const extra = area(union(groups[i], groups[j])) - area(groups[i]) - area(groups[j]);
        if (extra < CAPTURE_COST && (!best || extra < best.extra)) best = { i, j, extra };
      }
    }
    if (best) {
      const a = groups[best.i], b = groups[best.j];
      groups[best.i] = { ...union(a, b), members: a.members.concat(b.members) };
      groups.splice(best.j, 1);
      merged = true;
    }
  }
  return groups.map((g) => ({ box: { x: g.x, y: g.y, width: g.r - g.x, height: g.b - g.y }, members: g.members }));
}

// Text on a proven flat background (c.bg): the arithmetic of the pixel path below when
// every sample point shows that one colour.
function judgeSolid(c) {
  const a = (c.color.a ?? 1) * (c.opacity ?? 1);
  const { r: br, g: bgc, b: bb } = c.bg;
  const fr = Math.round(c.color.r * a + br * (1 - a)), fgc = Math.round(c.color.g * a + bgc * (1 - a)), fb = Math.round(c.color.b * a + bb * (1 - a));
  const bg = { r: br, g: bgc, b: bb };
  return { ratio: ratioOf(lumOf(fr, fgc, fb), lumOf(br, bgc, bb)), bg, fg: blend({ ...c.color, a }, bg), uniform: true };
}

// pts: offsets into the text-free capture D; rpts: the same pixels in the rendered capture R.
function judgePixels(c, pts, D, R, rpts) {
  if (c.complex && R) {
    // Real ink pixels: where the rendered capture differs most from the background capture.
    const deltas = pts.map((i, k) => { const j = rpts[k]; return { i, j, d: Math.abs(R[j] - D[i]) + Math.abs(R[j + 1] - D[i + 1]) + Math.abs(R[j + 2] - D[i + 2]) }; }).sort((a, b) => b.d - a.d);
    const ink = deltas.slice(0, Math.max(3, Math.floor(deltas.length * 0.15))).filter((p) => p.d > 24);
    const pick = ink.length ? ink : deltas.slice(0, 1);
    const rs = pick.map(({ i, j }) => ratioOf(lumOf(R[j], R[j + 1], R[j + 2]), lumOf(D[i], D[i + 1], D[i + 2]))).sort((a, b) => a - b);
    const { i: mid, j: mj } = pick[Math.floor(pick.length / 2)];
    return { ratio: ink.length ? percentile(rs, 0.5) : 1, fg: { r: R[mj], g: R[mj + 1], b: R[mj + 2] }, bg: { r: D[mid], g: D[mid + 1], b: D[mid + 2] }, uniform: true };
  }
  if (!c.color) return null;
  const a = (c.color.a ?? 1) * (c.opacity ?? 1);
  const cache = new Map();
  const ratios = [];
  let first = -1, uniform = true;
  for (const i of pts) {
    const key = (D[i] << 16) | (D[i + 1] << 8) | D[i + 2];
    if (first === -1) first = key;
    else if (uniform && Math.abs((key >> 16) - (first >> 16)) + Math.abs(((key >> 8) & 255) - ((first >> 8) & 255)) + Math.abs((key & 255) - (first & 255)) >= 12) uniform = false;
    let r = cache.get(key);
    if (r === undefined) {
      const br = D[i], bgc = D[i + 1], bb = D[i + 2];
      const fr = Math.round(c.color.r * a + br * (1 - a)), fgc = Math.round(c.color.g * a + bgc * (1 - a)), fb = Math.round(c.color.b * a + bb * (1 - a));
      r = ratioOf(lumOf(fr, fgc, fb), lumOf(br, bgc, bb));
      cache.set(key, r);
    }
    ratios.push([r, i]);
  }
  ratios.sort((p, q) => p[0] - q[0]);
  // 20th percentile: at least 80% of the background under the text must pass.
  const [ratio, mi] = percentile(ratios, 0.2);
  const bg = { r: D[mi], g: D[mi + 1], b: D[mi + 2] };
  return { ratio, bg, fg: blend({ ...c.color, a }, bg), uniform };
}

// What the proven background (c.bg) tells without pixels: 'exact' (one opaque colour: the
// ratio is computed), 'pass' (translucent layers, whose compositing may round each channel
// by up to bg.slack: the text passes even in the worst case), or null (capture it).
function proven(c, need) {
  if (!c.bg || c.complex || !c.color) return null;
  if (!c.bg.slack) return 'exact';
  if ((c.color.a ?? 1) * (c.opacity ?? 1) < 1) return null;
  const s = c.bg.slack, ch = (v) => Math.max(0, Math.min(255, v));
  const lf = luminance(c.color);
  const lo = luminance({ r: ch(c.bg.r - s), g: ch(c.bg.g - s), b: ch(c.bg.b - s) }), hi = luminance({ r: ch(c.bg.r + s), g: ch(c.bg.g + s), b: ch(c.bg.b + s) });
  if (lf >= lo && lf <= hi) return null;
  return Math.min(ratioOf(lf, lo), ratioOf(lf, hi)) >= need + 0.05 ? 'pass' : null;
}

// candidates: from the analyzer's collectContrast(true). check: a file to which a comparison
// of both ways is appended for every candidate with a proven background (then everything
// is captured and measured on pixels, as without the proof).
export async function measureContrast(page, candidates, { maxHeight, level = 'AA', check } = {}) {
  if (!candidates.length) return [];
  const { width, height } = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  const clipH = Math.min(maxHeight, height);
  const needOf = (c) => level === 'AAA' ? (c.large ? 4.5 : 7) : (c.large ? 3 : 4.5);
  candidates = candidates.map((c) => ({ ...c, rects: c.rects.filter((r) => r.y < clipH) }))
    .filter((c) => samplePoints(c.rects, width, clipH, null).length)
    .map((c) => ({ ...c, proven: proven(c, needOf(c)) }));
  const pixels = candidates.filter((c) => check || !c.proven);
  const complex = pixels.filter((c) => c.complex);
  // The cost of a capture grows with its area: capture the boxes around the text that needs
  // pixels, merged where one box is cheaper than two.
  const groups = check ? [{ box: { x: 0, y: 0, width, height: clipH }, members: pixels }] : clusters(pixels, width, clipH);
  const shot = async (box) => ({ ...box, data: PNG.sync.read(await page.screenshot({ fullPage: true, clip: box, animations: 'disabled', caret: 'hide' })).data });

  const T0 = Date.now();
  if (groups.length) {
    if (complex.length) {
      await page.evaluate((idx) => { idx.forEach((i) => { const el = window.__renderlint_cx && window.__renderlint_cx[i]; if (el) el.setAttribute('data-rl-cx', ''); }); }, complex.map((c) => c.idx));
    }
    for (const g of groups) {
      const rBox = boundsOf(g.members.filter((c) => c.complex).flatMap((c) => c.rects), width, clipH);
      if (rBox) { const img = await shot(rBox); for (const c of g.members) c.rendered = img; }
    }
    const handle = await page.addStyleTag({ content: HIDE_TEXT_CSS });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    for (const g of groups) { const img = await shot(g.box); for (const c of g.members) c.bgImg = img; }
    await handle.evaluate((el) => el.remove());
    if (complex.length) await page.evaluate(() => document.querySelectorAll('[data-rl-cx]').forEach((e) => e.removeAttribute('data-rl-cx')));
  }
  if (process.env.RENDERLINT_DEBUG) console.error(`    contrast @${width}: ${candidates.length} candidates, ${pixels.length} need pixels (${complex.length} complex), ${groups.length} capture box(es) ${groups.map((g) => g.box.width + 'x' + g.box.height).join(' ')}: ${Date.now() - T0}ms`);

  const results = [], log = [];
  for (const c of candidates) {
    const need = needOf(c);
    let m;
    if (c.proven === 'pass' && !check) continue;
    if (c.proven === 'exact' && !check) m = judgeSolid(c);
    else {
      const { bgImg, rendered } = c;
      if (!bgImg) continue;
      const pts = samplePoints(c.rects, width, clipH, bgImg);
      const rpts = c.complex && rendered ? samplePoints(c.rects, width, clipH, rendered) : null;
      m = judgePixels(c, pts, bgImg.data, rpts && rendered.data, rpts);
      if (check && c.proven && m) {
        const f = judgeSolid(c);
        log.push(JSON.stringify({ page: page.url(), w: width, sel: c.base.selector, text: c.base.text, need, kind: c.proven, ratio: +m.ratio.toFixed(3), fast: +f.ratio.toFixed(3),
          bg: hex(m.bg), fastBg: hex(f.bg), fg: hex(m.fg), fastFg: hex(f.fg), uniform: m.uniform, sug: suggestColor(m.fg, m.bg, need + 0.1), fastSug: suggestColor(f.fg, f.bg, need + 0.1) }));
      }
    }
    if (!m) continue;
    const { ratio, bg, fg, uniform } = m;
    if (ratio + 0.005 >= need) continue;
    results.push({
      ...c.base,
      rule: 'contrast',
      severity: c.placeholder ? 'warn' : undefined,
      message: (ratio < 1.5 ? 'Text is practically invisible' : 'Low text contrast') + (c.placeholder ? ' (placeholder)' : '') + ': ' + ratio.toFixed(2) + ':1, needs ' + need + ':1 — ' +
        hex(fg) + ' on ' + (uniform ? hex(bg) : 'a non-uniform background (≈' + hex(bg) + ')') + '.',
      details: { ratio: +ratio.toFixed(2), required: need, fg: hex(fg), bg: hex(bg), uniformBackground: uniform, fontSize: c.fontSize, large: c.large,
        suggestion: c.complex ? undefined : suggestColor(fg, bg, need + 0.1) },
    });
  }
  if (check) {
    const why = {};
    for (const c of candidates) {
      const k = c.proven ? null : c.bg ? 'layers-not-clear-pass' : c.why || (c.complex ? 'complex' : 'other');
      if (k) why[k] = (why[k] || 0) + 1;
      if (k) log.push(JSON.stringify({ fallback: k, sel: c.base.selector, w: width }));
    }
    appendFileSync(check, log.map((l) => l + '\n').join('') + JSON.stringify({ page: page.url(), w: width, total: candidates.length, solid: candidates.filter((c) => c.proven).length, why }) + '\n');
  }
  return results;
}
