// Screenshot-based contrast measurement. The page is captured twice: once as
// rendered and once with all text glyphs made transparent (text-fill-color, so
// currentColor icons and shapes stay painted). Pixels under each text
// run in the second capture are the *real* background (gradients, images,
// overlays, translucent layers included).
import { PNG } from 'pngjs';
import { blend, hex, suggestColor } from './color.js';

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

function samplePoints(rects, width, height, maxPoints = 300) {
  const pts = [];
  const area = rects.reduce((s, r) => s + r.w * r.h, 0) || 1;
  const step = Math.max(1, Math.sqrt(area / maxPoints));
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(width - 1, Math.ceil(r.x + r.w) - 1), y1 = Math.min(height - 1, Math.ceil(r.y + r.h) - 1);
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) pts.push((Math.round(y) * width + Math.round(x)) << 2);
  }
  return pts;
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }

export async function measureContrast(page, candidates, { maxHeight, level = 'AA' } = {}) {
  if (!candidates.length) return [];
  const complex = candidates.filter((c) => c.complex);
  const { width, height } = await page.evaluate(() => ({ width: document.documentElement.clientWidth, height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) }));
  const clipH = Math.min(maxHeight, height);
  const shot = async () => PNG.sync.read(await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width, height: clipH }, animations: 'disabled', caret: 'hide' }));

  if (complex.length) {
    await page.evaluate((idx) => { idx.forEach((i) => { const el = window.__renderlint_cx && window.__renderlint_cx[i]; if (el) el.setAttribute('data-rl-cx', ''); }); }, complex.map((c) => c.idx));
  }
  const rendered = complex.length ? await shot() : null;
  const handle = await page.addStyleTag({ content: HIDE_TEXT_CSS });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const bgImg = await shot();
  await handle.evaluate((el) => el.remove());
  await page.evaluate(() => document.querySelectorAll('[data-rl-cx]').forEach((e) => e.removeAttribute('data-rl-cx')));

  const W = bgImg.width, H = bgImg.height, D = bgImg.data;
  const results = [];
  for (const c of candidates) {
    const pts = samplePoints(c.rects.filter((r) => r.y < clipH), W, H);
    if (!pts.length) continue;
    const need = level === 'AAA' ? (c.large ? 4.5 : 7) : (c.large ? 3 : 4.5);
    let ratio, bg, fg, uniform = true;
    if (c.complex && rendered) {
      // Real ink pixels: where the rendered capture differs most from the background capture.
      const R = rendered.data;
      const deltas = pts.map((i) => ({ i, d: Math.abs(R[i] - D[i]) + Math.abs(R[i + 1] - D[i + 1]) + Math.abs(R[i + 2] - D[i + 2]) })).sort((a, b) => b.d - a.d);
      const ink = deltas.slice(0, Math.max(3, Math.floor(deltas.length * 0.15))).filter((p) => p.d > 24);
      const pick = ink.length ? ink : deltas.slice(0, 1);
      const rs = pick.map(({ i }) => ratioOf(lumOf(R[i], R[i + 1], R[i + 2]), lumOf(D[i], D[i + 1], D[i + 2]))).sort((a, b) => a - b);
      ratio = ink.length ? percentile(rs, 0.5) : 1;
      const mid = pick[Math.floor(pick.length / 2)].i;
      fg = { r: R[mid], g: R[mid + 1], b: R[mid + 2] };
      bg = { r: D[mid], g: D[mid + 1], b: D[mid + 2] };
    } else {
      if (!c.color) continue;
      const a = (c.color.a ?? 1) * (c.opacity ?? 1);
      const cache = new Map();
      const ratios = [];
      let first = -1;
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
      const [r20] = percentile(ratios, 0.2);
      ratio = r20;
      const [, mi] = ratios[Math.floor(ratios.length * 0.2)];
      bg = { r: D[mi], g: D[mi + 1], b: D[mi + 2] };
      fg = blend({ ...c.color, a }, bg);
    }
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
  return results;
}

