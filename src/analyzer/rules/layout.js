// Layout rules: text and boxes escaping their containers, viewport overflow,
// accidental scrollbars.

const SVG_NS = 'http://www.w3.org/2000/svg';

function borders(el) {
  const s = RL.cs(el);
  return { t: parseFloat(s.borderTopWidth) || 0, r: parseFloat(s.borderRightWidth) || 0,
    b: parseFloat(s.borderBottomWidth) || 0, l: parseFloat(s.borderLeftWidth) || 0 };
}

function paddingBox(el) {
  const r = RL.rectOf(el), b = borders(el);
  return { x: r.x + b.l, y: r.y + b.t, right: r.right - b.r, bottom: r.bottom - b.b, w: r.w - b.l - b.r, h: r.h - b.t - b.b };
}
RL.paddingBox = paddingBox;

function overflowBeyond(rects, box) {
  const o = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const r of rects) {
    o.left = Math.max(o.left, box.x - r.x);
    o.right = Math.max(o.right, r.right - box.right);
    o.top = Math.max(o.top, box.y - r.y);
    o.bottom = Math.max(o.bottom, r.bottom - box.bottom);
  }
  return o;
}

function fontSize(el) { return parseFloat(RL.cs(el).fontSize) || 16; }

function fmtOver(o, tolX, tolY) {
  const parts = [];
  if (o.right > tolX) parts.push(Math.round(o.right) + 'px past the right edge');
  if (o.left > tolX) parts.push(Math.round(o.left) + 'px past the left edge');
  if (o.bottom > tolY) parts.push(Math.round(o.bottom) + 'px past the bottom');
  if (o.top > tolY) parts.push(Math.round(o.top) + 'px past the top');
  return parts.join(', ');
}

function isIntentionalTruncation(textEl, clipper, axis) {
  for (let n = textEl; n; n = RL.parentOf(n)) {
    const s = RL.cs(n);
    if (axis === 'x' && s.textOverflow === 'ellipsis') return true;
    if (s.webkitLineClamp && s.webkitLineClamp !== 'none') return true;
    if (s.maskImage && s.maskImage !== 'none') return true;
    if (s.webkitMaskImage && s.webkitMaskImage !== 'none') return true;
    if (n === clipper) break;
  }
  return false;
}

// ---------------------------------------------------------------------------
RL.rule({
  id: 'text-overflow',
  run(ctx) {
    const seen = new Set();
    for (const t of ctx.texts) {
      if (RL.isIgnored(t.el, 'text-overflow')) continue;
      const block = RL.nearestBlock(t.el);
      if (block.namespaceURI === SVG_NS) continue; // svg text is handled by text-clipped
      const fs = fontSize(t.el);
      const tolX = 1.5, tolY = Math.max(2, fs * 0.3);
      let needX = true, needY = true;
      for (let n = block, d = 0; n && n !== document.body && n !== document.documentElement && d < 40 && (needX || needY); n = RL.parentOf(n), d++) {
        if (RL.clips(n, 'x') || RL.clips(n, 'y')) break; // clipping is text-clipped's job
        const sides = RL.boundarySides(n);
        if (sides) {
          const o = overflowBeyond(t.rects, paddingBox(n));
          const cx = needX && sides.x, cy = needY && sides.y;
          if (!cx) { o.left = 0; o.right = 0; }
          if (!cy) { o.top = 0; o.bottom = 0; }
          if (sides.x) needX = false;
          if (sides.y) needY = false;
          if ((o.left > tolX || o.right > tolX || o.top > tolY || o.bottom > tolY) && !seen.has(n)) {
            seen.add(n);
            const own = n === block;
            ctx.report({
              rule: 'text-overflow', el: t.el, related: own ? undefined : n,
              message: 'Text spills outside its ' + (own ? 'box' : 'container') + ' (' + fmtOver(o, tolX, tolY) + ').',
              details: { overflow: o, whiteSpace: RL.cs(t.el).whiteSpace, overflowWrap: RL.cs(block).overflowWrap },
            });
            break;
          }
        }
        if (RL.isOutOfFlow(n)) break;
      }
    }
  },
});

// ---------------------------------------------------------------------------
RL.rule({
  id: 'text-clipped',
  run(ctx) {
    const seen = new Set();
    for (const t of ctx.texts) {
      if (RL.isIgnored(t.el, 'text-clipped')) continue;
      const fs = fontSize(t.el);
      let passedAbs = false;
      for (let n = t.el, d = 0; n && n !== document.body && n !== document.documentElement && d < 40; n = RL.parentOf(n), d++) {
        const s = RL.cs(n);
        const isSvgRoot = n.namespaceURI === SVG_NS && n.tagName.toLowerCase() === 'svg';
        if (n.namespaceURI === SVG_NS && !isSvgRoot) continue;
        if (s.position === 'fixed') break;
        const doesClip = !(passedAbs && s.position === 'static' && s.transform === 'none');
        if (doesClip && (isSvgRoot ? s.overflow !== 'visible' : (RL.clips(n, 'x') || RL.clips(n, 'y')))) {
          const scrollX = !isSvgRoot && RL.isScrollContainer(n, 'x');
          const scrollY = !isSvgRoot && RL.isScrollContainer(n, 'y');
          if (scrollX && scrollY) break; // scrollable area: partially visible content is expected
          const box = isSvgRoot ? RL.rectOf(n) : paddingBox(n);
          if (box.w <= 2 || box.h <= 2) break;
          const inter = t.rects.some((r) => RL.intersect(r, box));
          if (!inter) break; // fully hidden (carousel slide, collapsed panel): not a defect
          const o = overflowBeyond(t.rects, box);
          const tolX = 2, tolY = Math.max(2, fs * 0.28);
          const cutX = !scrollX && (isSvgRoot || RL.clips(n, 'x')) && (o.left > tolX || o.right > tolX);
          const cutY = !scrollY && (isSvgRoot || RL.clips(n, 'y')) && (o.top > tolY || o.bottom > tolY);
          if ((cutX || cutY) && !seen.has(n)) {
            if (cutX && !cutY && isIntentionalTruncation(t.el, n, 'x')) break;
            if (cutY && isIntentionalTruncation(t.el, n, 'y')) break;
            seen.add(n);
            ctx.report({
              rule: 'text-clipped', el: t.el, related: n === t.el ? undefined : n,
              message: 'Text is cut off by ' + (isSvgRoot ? 'the edge of its <svg>' : 'an overflow:' + (cutX ? s.overflowX : s.overflowY) + ' container') +
                ' (' + fmtOver(o, cutX ? tolX : 1e9, cutY ? tolY : 1e9) + ').',
              details: { overflow: o, clipper: isSvgRoot ? 'svg' : 'overflow' },
            });
          }
          break;
        }
        if (s.position === 'absolute') passedAbs = true;
        else if (s.position !== 'static' || s.transform !== 'none') passedAbs = false;
      }
    }
  },
});

// ---------------------------------------------------------------------------
const MEDIA = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'picture']);
const CONTROL = new Set(['button', 'input', 'select', 'textarea']);
RL.isSolid = function (el) {
  const tag = el.tagName.toLowerCase();
  if (MEDIA.has(tag) && (tag !== 'svg' || !(el.parentElement && el.parentElement.closest('svg')))) return true;
  if (CONTROL.has(tag)) return true;
  if (RL.isInline(el)) return false;
  return RL.hasVisibleBoundary(el);
};

RL.rule({
  id: 'content-overflow',
  run(ctx) {
    const seen = new Set();
    for (const el of ctx.elements) {
      if (!RL.isSolid(el) || !RL.isVisible(el) || RL.isOutOfFlow(el)) continue;
      if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== 'svg') continue;
      if (RL.cs(el).transform !== 'none') continue;
      if (RL.isIgnored(el, 'content-overflow')) continue;
      const er = RL.rectOf(el);
      if (er.w < 4 || er.h < 4) continue;
      for (let n = RL.parentOf(el), d = 0; n && n !== document.body && n !== document.documentElement && d < 30; n = RL.parentOf(n), d++) {
        if (RL.clips(n, 'x') || RL.clips(n, 'y')) {
          // A clipped control is unusable; clipped media/cards are usually intentional crops.
          if (RL.isInteractive(el) && !RL.isScrollContainer(n, 'x') && !RL.isScrollContainer(n, 'y') && !seen.has(n)) {
            const box = paddingBox(n);
            const o = overflowBeyond([er], box);
            if ((o.left > 2 || o.right > 2 || o.top > 2 || o.bottom > 2) && RL.intersect(er, box)) {
              seen.add(n);
              ctx.report({ rule: 'content-overflow', el, related: n, message: 'Interactive element is partially cut off by its overflow:hidden container (' + fmtOver(o, 2, 2) + ').', details: { overflow: o, clipped: true } });
            }
          }
          break;
        }
        const sides = RL.boundarySides(n);
        if (sides) {
          if (seen.has(n)) break;
          const o = overflowBeyond([er], paddingBox(n));
          if (!sides.x) { o.left = 0; o.right = 0; }
          if (!sides.y) { o.top = 0; o.bottom = 0; }
          if (o.left > 2 || o.right > 2 || o.top > 2 || o.bottom > 2) {
            seen.add(n);
            ctx.report({ rule: 'content-overflow', el, related: n, message: 'Element sticks out of its container (' + fmtOver(o, 2, 2) + ').', details: { overflow: o } });
            break;
          }
          if (sides.x && sides.y) break;
        }
        if (RL.isOutOfFlow(n) || RL.cs(n).transform !== 'none') break;
      }
    }
  },
});

// ---------------------------------------------------------------------------
RL.rule({
  id: 'viewport-overflow',
  run(ctx) {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const scrollW = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const hs = RL.cs(de), bs = RL.cs(document.body);
    const canScroll = !/hidden|clip/.test(hs.overflowX) && !/hidden|clip/.test(bs.overflowX);
    const scrolls = canScroll && scrollW > vw + 1;

    const culprit = new Map();
    for (const el of ctx.elements) {
      if (!RL.isVisible(el)) continue;
      const s = RL.cs(el);
      if (s.position === 'fixed') continue;
      if (el.namespaceURI === SVG_NS && el.tagName.toLowerCase() !== 'svg') continue;
      if (RL.isInline(el) && !el.firstElementChild && el.tagName !== 'IMG') { /* inline text handled via its block */ }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const over = Math.max(r.right + scrollX - vw, -(r.left + scrollX));
      if (over <= 1) continue;
      // fully off-screen (off-canvas menus) only matters if the page actually scrolls
      if ((r.left + scrollX >= vw || r.right + scrollX <= 0) && !scrolls) continue;
      let clipped = false;
      for (let n = RL.parentOf(el); n && n !== document.body && n !== de; n = RL.parentOf(n)) {
        if (RL.clips(n, 'x')) {
          const nr = n.getBoundingClientRect();
          if (nr.right + scrollX <= vw + 1 && nr.left + scrollX >= -1) { clipped = true; break; }
        }
        if (RL.cs(n).position === 'fixed') { clipped = true; break; }
      }
      if (clipped) continue;
      culprit.set(el, over);
    }
    // Keep only the outermost culprits (whose parent is not itself overflowing as much).
    const roots = [];
    for (const [el, over] of culprit) {
      const p = RL.parentOf(el);
      if (p && culprit.has(p) && culprit.get(p) >= over - 1) continue;
      if (RL.isIgnored(el, 'viewport-overflow')) continue;
      roots.push([el, over]);
    }
    roots.sort((a, b) => b[1] - a[1]);
    for (const [el, over] of roots.slice(0, 6)) {
      if (!scrolls) {
        // Page cannot scroll sideways: only content that gets cut off matters.
        const hasContent = (el.innerText || '').trim() || RL.isInteractive(el) || el.querySelector('img,svg,button,a,input');
        if (!hasContent) continue;
      }
      ctx.report({
        rule: 'viewport-overflow', el,
        message: scrolls
          ? 'Element extends ' + Math.round(over) + 'px beyond the ' + vw + 'px viewport, causing horizontal page scroll.'
          : 'Element extends ' + Math.round(over) + 'px beyond the ' + vw + 'px viewport and is cut off (overflow-x is hidden on the page).',
        details: { overflow: Math.round(over), viewportWidth: vw, pageScrollWidth: scrollW, width: Math.round(el.getBoundingClientRect().width), cssWidth: RL.cs(el).width, minWidth: RL.cs(el).minWidth, whiteSpace: RL.cs(el).whiteSpace },
      });
    }
  },
});

// ---------------------------------------------------------------------------
RL.rule({
  id: 'accidental-scrollbar',
  run(ctx) {
    for (const el of ctx.elements) {
      const tag = el.tagName;
      if (tag === 'TEXTAREA' || tag === 'SELECT' || el === document.body) continue;
      const s = RL.cs(el);
      if (!/auto|scroll/.test(s.overflowX + s.overflowY)) continue;
      if (!RL.isVisible(el) || RL.isIgnored(el, 'accidental-scrollbar')) continue;
      for (const axis of ['y', 'x']) {
        const mode = axis === 'y' ? s.overflowY : s.overflowX;
        if (mode !== 'auto' && mode !== 'scroll') continue;
        const client = axis === 'y' ? el.clientHeight : el.clientWidth;
        const diff = axis === 'y' ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth;
        if (client < 16) continue;
        if (diff > 0 && diff <= 24) {
          ctx.report({
            rule: 'accidental-scrollbar', el, severity: diff <= 8 ? undefined : 'warn',
            message: 'Content overflows by only ' + diff + 'px on the ' + axis + ' axis, producing a scrollbar for a tiny amount of content.',
            details: { axis, overflow: diff, mode },
          });
          break;
        }
      }
    }
  },
});
