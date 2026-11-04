// Screenshot-based dropdown check. The arrow of a <select> is drawn by the
// browser (or by a background-image), so its position isn't in the DOM. Each
// candidate's inner box is captured, and the first and last columns of "ink"
// (pixels that differ from the control's own background) give the insets of
// the text on the left and of the arrow on the right.
import { PNG } from 'pngjs';

const dist = (d, i, c) => Math.abs(d[i] - c[0]) + Math.abs(d[i + 1] - c[1]) + Math.abs(d[i + 2] - c[2]);

export function inkInsets(png, radius = 0) {
  const { width: W, height: H, data: D } = png;
  if (W < 8 || H < 8) return null;
  // Middle band of rows: away from rounded corners and borders.
  const y0 = Math.floor(H * 0.3), y1 = Math.max(y0 + 1, Math.ceil(H * 0.7));
  const counts = new Map();
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) << 2;
    const k = (D[i] << 16) | (D[i + 1] << 8) | D[i + 2];
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bgKey = 0, best = -1;
  for (const [k, n] of counts) if (n > best) { best = n; bgKey = k; }
  const bg = [bgKey >> 16, (bgKey >> 8) & 255, bgKey & 255];
  const ink = new Uint8Array(W);
  for (let x = 0; x < W; x++) for (let y = y0; y < y1; y++) if (dist(D, (y * W + x) << 2, bg) > 60) { ink[x] = 1; break; }
  // A large radius shows the page behind the corners at the far columns: drop ink runs touching the edges.
  if (radius > H * 0.25) {
    for (let x = 0; x < W && ink[x]; x++) ink[x] = 0;
    for (let x = W - 1; x >= 0 && ink[x]; x--) ink[x] = 0;
  }
  let left = -1, right = -1;
  for (let x = 0; x < W; x++) if (ink[x]) { left = x; break; }
  for (let x = W - 1; x >= 0; x--) if (ink[x]) { right = x; break; }
  if (left < 0) return null;
  return { left, right: W - 1 - right, width: W };
}

export async function measureDropdowns(page, candidates) {
  const out = [];
  for (const c of candidates) {
    const b = c.inner;
    // Stay 1px inside the border: fractional positions would otherwise pull the border's column in.
    const x0 = Math.ceil(b.x) + 1, y0 = Math.ceil(b.y) + 1;
    const clip = { x: x0, y: y0, width: Math.floor(b.right) - 1 - x0, height: Math.floor(b.bottom) - 1 - y0 };
    if (clip.width < 8 || clip.height < 8) continue;
    let png;
    try { png = PNG.sync.read(await page.screenshot({ fullPage: true, clip, animations: 'disabled', caret: 'hide' })); } catch { continue; }
    const m = inkInsets(png, c.radius);
    if (!m) continue;
    m.left += 1; m.right += 1;
    // The arrow (rightmost ink) hugs the border while the text keeps a comfortable inset.
    if (m.right <= m.left * 0.4 && m.left - m.right >= 10) {
      out.push({
        ...c.base,
        rule: 'dropdown-arrow',
        message: `The dropdown arrow sits ${m.right}px from the right border while the text starts ${m.left}px from the left, so the arrow looks jammed against the edge.` +
          (c.native ? ' The browser draws the native arrow near the border regardless of padding-right.' : ''),
        details: { arrowInset: m.right, textInset: m.left, native: c.native },
      });
    }
  }
  return out;
}

// Opens each menu trigger on the page (two per repeated kind, at most `max`) and checks that the
// menu, dropdown or popover it opens can be seen (popup-obscured). Closes it again with Escape, or by
// clicking the trigger. `disturbed`: a menu stayed open or a click navigated, so the page needs a reload.
export async function checkMenus(page, { max = 8, shot } = {}) {
  const url = page.url();
  let triggers;
  try { triggers = await page.evaluate((m) => window.__renderlint.menuTriggers(m), max); } catch { return { issues: [], disturbed: false }; }
  const issues = [];
  let disturbed = false;
  const still = (sel) => page.evaluate((s) => window.__renderlint.menuStillOpen(s), sel).catch(() => false);
  // a frame for the framework to render the menu, then its enter animation jumped to the end
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(() => {
    window.__renderlint.finishAnimations();
    requestAnimationFrame(() => requestAnimationFrame(r));
  }, 40))));
  for (const sel of triggers) {
    try {
      await page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' }); }, sel);
      await page.click(sel, { timeout: 1500 });
    } catch { continue; } // covered or detached: other rules report a covered control
    if (page.url() !== url) { disturbed = true; break; }
    await settle().catch(() => {});
    const r = await page.evaluate((s) => window.__renderlint.checkMenu(s), sel).catch(() => null);
    if (r && r.issue) {
      if (shot) r.issue.screenshot = await shot(r.issue, issues.length).catch(() => undefined);
      issues.push(r.issue);
    }
    await page.keyboard.press('Escape').catch(() => {});
    if (await still(sel)) await settle().catch(() => {}); // an exit animation, or a framework that closes on the next frame
    if (await still(sel)) {
      await page.click(sel, { timeout: 1000 }).catch(() => {});
      await settle().catch(() => {});
      if (await still(sel)) { disturbed = true; break; }
    }
    if (page.url() !== url) { disturbed = true; break; }
  }
  await page.evaluate(() => {
    for (const e of document.querySelectorAll('[data-rl-menu],[data-rl-was-open]')) { e.removeAttribute('data-rl-menu'); e.removeAttribute('data-rl-was-open'); }
    window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }).catch(() => {});
  return { issues, disturbed };
}
