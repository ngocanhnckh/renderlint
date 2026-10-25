// Screenshot-based contrast measurement. The page is captured twice: once as
// rendered and once with all text made transparent. Pixels under each text
// run in the second capture are the *real* background (gradients, images,
// overlays, translucent layers included).
import { PNG } from 'pngjs';
import { blend, contrast, hex, suggestColor } from './color.js';

const HIDE_TEXT_CSS = `
*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important;
  transition: none !important; }
::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; }
svg text, svg tspan, svg textPath { fill: transparent !important; stroke: transparent !important; }
[data-rl-cx] { background-image: none !important; }
`;

function decode(buf) { return PNG.sync.read(buf); }

function px(img, x, y) {
  const i = (img.width * y + x) << 2;
  return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] };
}

function samplePoints(rects, img, maxPoints = 500) {
  const pts = [];
  const area = rects.reduce((s, r) => s + r.w * r.h, 0) || 1;
  const step = Math.max(1, Math.sqrt(area / maxPoints));
  for (const r of rects) {
    const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(img.width - 1, Math.ceil(r.x + r.w) - 1), y1 = Math.min(img.height - 1, Math.ceil(r.y + r.h) - 1);
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) pts.push([Math.round(x), Math.round(y)]);
  }
  return pts;
}

function percentile(sorted, p) { return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * p)))]; }

export async function measureContrast(page, candidates, { maxHeight, level = 'AA' } = {}) {
  if (!candidates.length) return [];
  const complex = candidates.filter((c) => c.complex);
  const clipH = Math.min(maxHeight, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)));
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const shot = async () => decode(await page.screenshot({ fullPage: true, clip: { x: 0, y: 0, width, height: clipH }, animations: 'disabled', caret: 'hide' }));

  if (complex.length) {
    await page.evaluate((sels) => { sels.forEach((i) => { const el = window.__renderlint_cx && window.__renderlint_cx[i]; if (el) el.setAttribute('data-rl-cx', ''); }); }, complex.map((c) => c.idx));
  }
  const rendered = complex.length ? await shot() : null;
  const handle = await page.addStyleTag({ content: HIDE_TEXT_CSS });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const bgImg = await shot();
  await handle.evaluate((el) => el.remove());
  await page.evaluate(() => document.querySelectorAll('[data-rl-cx]').forEach((e) => e.removeAttribute('data-rl-cx')));

  const results = [];
  for (const c of candidates) {
    const rects = c.rects.filter((r) => r.y < clipH);
    if (!rects.length) continue;
    const pts = samplePoints(rects, bgImg);
    if (!pts.length) continue;
    const need = level === 'AAA' ? (c.large ? 4.5 : 7) : (c.large ? 3 : 4.5);
    let ratios = [], bgs = [], fgOut;
    if (c.complex && rendered) {
      const deltas = pts.map(([x, y]) => {
        const a = px(rendered, x, y), b = px(bgImg, x, y);
        return { a, b, d: Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) };
      }).sort((p, q) => q.d - p.d);
      const ink = deltas.slice(0, Math.max(3, Math.floor(deltas.length * 0.15))).filter((p) => p.d > 24);
      if (!ink.length) { ratios = [1]; bgs = [deltas[0].b]; fgOut = deltas[0].b; }
      else {
        ratios = ink.map((p) => contrast(p.a, p.b)).sort((p, q) => p - q);
        bgs = ink.map((p) => p.b);
        fgOut = ink[Math.floor(ink.length / 2)].a;
      }
      ratios = [percentile(ratios, 0.5)];
    } else {
      if (!c.color) continue;
      const fg = { ...c.color, a: (c.color.a ?? 1) * (c.opacity ?? 1) };
      for (const [x, y] of pts) {
        const bg = px(bgImg, x, y);
        bgs.push(bg);
        ratios.push(contrast(blend(fg, bg), bg));
      }
      ratios.sort((a, b) => a - b);
    }
    // 20th percentile: at least 80% of the background under the text passes.
    const ratio = percentile(ratios, 0.2);
    if (ratio + 0.005 >= need) continue;
    // representative background: the one producing the median failing ratio
    const bgSorted = bgs.slice().sort((p, q) => (p.r + p.g + p.b) - (q.r + q.g + q.b));
    const bg = bgSorted[Math.floor(bgSorted.length / 2)];
    const fg = fgOut || blend({ ...c.color, a: (c.color.a ?? 1) * (c.opacity ?? 1) }, bg);
    const uniform = bgs.every((b) => Math.abs(b.r - bg.r) + Math.abs(b.g - bg.g) + Math.abs(b.b - bg.b) < 12);
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
