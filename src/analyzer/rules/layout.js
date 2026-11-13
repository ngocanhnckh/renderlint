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
          for (const k of ['top', 'right', 'bottom', 'left']) if (!sides[k]) o[k] = 0; // past an edge that isn't drawn
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

// Text that still fits inside the box but has eaten its side padding and nearly
// touches the border: the box was designed with room, the content outgrew it.
RL.rule({
  id: 'text-crowding',
  run(ctx) {
    const seen = new Set();
    for (const t of ctx.texts) {
      if (RL.isIgnored(t.el, 'text-crowding') || RL.flagged.has(t.el)) continue;
      const block = RL.nearestBlock(t.el);
      if (block.namespaceURI === SVG_NS) continue;
      for (let n = block, d = 0; n && n !== document.body && n !== document.documentElement && d < 6; n = RL.parentOf(n), d++) {
        const sides = !RL.isInline(n) && RL.boundarySides(n);
        if (sides && sides.x) {
          const s = RL.cs(n);
          const pl = parseFloat(s.paddingLeft) || 0, pr = parseFloat(s.paddingRight) || 0;
          const box = paddingBox(n);
          const minX = Math.min(...t.rects.map((r) => r.x)), maxX = Math.max(...t.rects.map((r) => r.right));
          const gapL = minX - box.x, gapR = box.right - maxX;
          // Only boxes designed with side padding; text past the padding box is text-overflow's job.
          const side = pr >= 8 && gapR > -1.5 && gapR < Math.min(4, pr * 0.35) ? 'right' : pl >= 8 && gapL > -1.5 && gapL < Math.min(4, pl * 0.35) ? 'left' : null;
          if (side && !seen.has(n) && box.w < innerWidth - 4) {
            seen.add(n);
            const gap = Math.max(0, Math.round(side === 'right' ? gapR : gapL));
            ctx.report({
              rule: 'text-crowding', el: t.el, related: n === block ? undefined : n,
              message: 'Text has run through the box\'s ' + Math.round(side === 'right' ? pr : pl) + 'px ' + side + ' padding and sits ' + gap + 'px from its edge.',
              details: { side, gap, padding: side === 'right' ? pr : pl },
            });
          }
          break;
        }
        if (RL.isOutOfFlow(n) || RL.clips(n, 'x')) break;
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
          // one report per clipped HTML box, but every clipped label of an SVG chart
          const key = isSvgRoot ? t.el : n;
          if ((cutX || cutY) && !seen.has(key)) {
            if (cutX && !cutY && isIntentionalTruncation(t.el, n, 'x')) break;
            if (cutY && isIntentionalTruncation(t.el, n, 'y')) break;
            seen.add(key);
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
// Content no one can scroll to: it lies below the bottom of a box that clips (overflow: hidden or clip),
// or below the screen when the page itself doesn't scroll (overflow: hidden on <html> or <body>), and
// nothing between them scrolls. A fixed-height app shell whose page area doesn't scroll, a scroll lock
// left on. text-clipped covers text cut through; this is text past the edge entirely. Content moved
// away on purpose is left out: by a transform (slides, drawers, sheets), out of flow (absolute, fixed),
// in a small box (a teaser, a collapsed panel), next to a "Show more" control, or faded out.
// Only with scrollCheck: the runner then turns the mouse wheel over each box, and a box whose content
// moves (a JavaScript scroller on overflow: hidden) is not reported.
const MORE_LABEL = /\b(show|read|see|view|load)\s+(more|all|full|everything)\b|\bexpand\b|\bmore\s*(…|\.\.\.)\s*$/i;
const clipsY = (s) => s.overflowY === 'hidden' || s.overflowY === 'clip';
RL.rule({
  id: 'unreachable-content',
  run(ctx) {
    if (!RL.options.scrollCheck || RL.modalRoot()) return; // an open dialog locks the page on purpose
    const html = document.documentElement, body = document.body;
    if (!body) return;
    const hs = RL.cs(html), bs = RL.cs(body);
    const pageLocked = clipsY(hs) || (hs.overflowY === 'visible' && clipsY(bs));
    const minH = Math.max(150, innerHeight * 0.3);
    const groups = new Map(); // clipping box (or html for the screen) → hidden text
    const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      const el = n.parentElement;
      if (!t || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName) || !RL.isVisible(el) || RL.isIgnored(el, 'unreachable-content')) continue;
      range.selectNodeContents(n);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5).map(RL.docRect);
      if (!rects.length) continue;
      // the first box up the tree that decides whether this text can be scrolled to
      let clipper = null;
      for (let a = el; a; a = RL.parentOf(a)) {
        if (RL.isDevTool(a) || a.getAttribute('aria-hidden') === 'true' || a.inert) { clipper = null; break; }
        if (a === body || a === html) { clipper = pageLocked ? html : null; break; }
        const s = RL.cs(a);
        if (s.position === 'fixed' || s.position === 'sticky' || s.transform !== 'none' || s.translate !== 'none') break;
        if (s.webkitLineClamp && s.webkitLineClamp !== 'none') break;
        if ((s.maskImage && s.maskImage !== 'none') || (s.webkitMaskImage && s.webkitMaskImage !== 'none')) break;
        if (RL.isScrollContainer(a, 'y')) break; // it scrolls
        // a box that clips but holds this text (a row with an ellipsis) doesn't hide it: look further up
        if (clipsY(s)) { const b = RL.paddingBox(a); if (rects.every((r) => r.y >= b.bottom - 1)) { clipper = a; break; } }
        if (s.position === 'absolute') break; // out of flow: menus, tooltips, positioned decorations
      }
      if (!clipper) continue;
      const box = clipper === html ? { x: scrollX, y: scrollY, right: scrollX + innerWidth, bottom: scrollY + innerHeight, w: innerWidth, h: innerHeight } : RL.paddingBox(clipper);
      if (box.h < minH || box.w < 120) continue;
      // entirely below the box, and under it (not beside it: a slide moved sideways)
      if (!rects.every((r) => r.y >= box.bottom - 1 && r.x < box.right && r.right > box.x)) continue;
      if (!groups.has(clipper)) groups.set(clipper, { box, items: [] });
      groups.get(clipper).items.push({ el, t, rects });
    }
    for (const [clipper, g] of groups) {
      const chars = g.items.reduce((a, x) => a + x.t.length, 0);
      const bottom = Math.max(...g.items.flatMap((x) => x.rects.map((r) => r.bottom)));
      const below = Math.round(bottom - g.box.bottom);
      if (g.items.length < 2 || chars < 30 || below < 60) continue;
      // a "Show more" / "Read more" control in or right after the box reveals the rest
      const scope = clipper === html ? null : clipper.parentElement || clipper;
      if (scope && Array.from(scope.querySelectorAll('button,a[href],summary,[role=button]')).some((b) => MORE_LABEL.test((b.textContent || b.getAttribute('aria-label') || '').trim()))) continue;
      const sample = [];
      for (const x of g.items) { if (!sample.includes(x.t.slice(0, 40))) sample.push(x.t.slice(0, 40)); if (sample.length >= 3) break; }
      const s = clipper === html ? (clipsY(hs) ? hs : bs) : RL.cs(clipper);
      const where = clipper === html ? 'the screen: the page itself doesn\'t scroll (overflow-y: ' + s.overflowY + ' on <' + (clipsY(hs) ? 'html' : 'body') + '>)' : 'this box (overflow-y: ' + s.overflowY + '), and neither it nor anything around the content scrolls';
      ctx.report({
        rule: 'unreachable-content', el: clipper === html ? (clipsY(hs) ? html : body) : clipper, needsScrollCheck: true, // the element to fix
        message: 'Content can\'t be scrolled to: ' + g.items.length + ' piece' + (g.items.length === 1 ? '' : 's') + ' of text, reaching ' + below + 'px below the bottom of ' + where + ' (' + sample.map((x) => '"' + x + '"').join(', ') + ').',
        details: { below, hidden: g.items.length, clipper: clipper === html ? 'page' : 'box', overflowY: s.overflowY, sample, boxHeight: Math.round(g.box.h) },
      });
    }
  },
});

// ---------------------------------------------------------------------------
const MEDIA = new Set(['img', 'video', 'canvas', 'svg', 'iframe', 'picture']);
const CONTROL = new Set(['button', 'input', 'select', 'textarea']);
const TABLE_PARTS = new Set(['col', 'colgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption']);
RL.isSolid = function (el) {
  const tag = el.tagName.toLowerCase();
  if (TABLE_PARTS.has(tag) || /^table-/.test(RL.cs(el).display)) return false; // table internals tile, never overlap
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
          for (const k of ['top', 'right', 'bottom', 'left']) if (!sides[k]) o[k] = 0; // past an edge that isn't drawn
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
    // Text that runs past the viewport out of a box that fits (a long unbreakable word in a heading with
    // no border or background, so text-overflow has no box to measure against): the page scrolls sideways.
    // Only when it does: the visible parts of the text are already cut to every clipping ancestor.
    const textOnly = new Set();
    if (scrolls) {
      for (const t of ctx.texts) {
        if (culprit.has(t.el) || RL.flagged.has(t.el) || RL.isIgnored(t.el, 'viewport-overflow')) continue;
        const over = Math.max(...t.vis.map((r) => r.x + r.w)) - vw;
        if (over <= 1) continue;
        // in a fixed layer, or inside a box already reported as too wide
        let skip = false;
        for (let n = t.el; n && n !== document.body && n !== de && !skip; n = RL.parentOf(n)) skip = RL.cs(n).position === 'fixed' || (n !== t.el && culprit.has(n) && !textOnly.has(n));
        if (skip) continue;
        culprit.set(t.el, over);
        textOnly.add(t.el);
      }
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
        message: textOnly.has(el)
          ? 'Text runs ' + Math.round(over) + 'px beyond the ' + vw + 'px viewport, causing horizontal page scroll (a long word or URL that does not wrap: overflow-wrap: anywhere).'
          : scrolls
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
