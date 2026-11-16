// Overlap rules: colliding text (incl. chart/diagram labels), colliding boxes,
// content hidden underneath other layers.

const CELL = 96;
function spatialPairs(items, rectsOf, cb) {
  const grid = new Map();
  items.forEach((it, i) => {
    for (const r of rectsOf(it)) {
      for (let cx = Math.floor(r.x / CELL); cx <= Math.floor(r.right / CELL); cx++) {
        for (let cy = Math.floor(r.y / CELL); cy <= Math.floor(r.bottom / CELL); cy++) {
          const k = cx + ':' + cy;
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push([i, r]);
        }
      }
    }
  });
  const done = new Set();
  for (const list of grid.values()) {
    if (list.length < 2) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const [i, ri] = list[a], [j, rj] = list[b];
        if (i === j) continue;
        const key = i < j ? i + ',' + j : j + ',' + i;
        if (done.has(key)) continue;
        const inter = RL.intersect(ri, rj);
        if (!inter) continue;
        if (cb(items[i], items[j], ri, rj, inter) === true) done.add(key);
      }
    }
  }
}

// Is an opaque layer painted between two elements at a point? (=> lower one hidden)
function occludedBetween(stack, upperEl, lowerEl) {
  const iu = stack.findIndex((e) => e === upperEl || RL.containsComposed(upperEl, e));
  const il = stack.findIndex((e) => e === lowerEl || RL.containsComposed(lowerEl, e));
  if (iu === -1 || il === -1) return false;
  const [a, b] = iu < il ? [iu, il] : [il, iu];
  const lower = iu < il ? lowerEl : upperEl;
  // includes the upper element itself: an opaque box (tooltip, badge) hides what is under it
  for (let k = a; k < b; k++) {
    const e = stack[k];
    if (RL.containsComposed(e, lower)) continue; // ancestor of the lower element
    if (RL.isOpaqueLayer(e)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
RL.rule({
  id: 'text-overlap',
  order: 90,
  run(ctx) {
    const texts = ctx.texts.filter((t) => !RL.isIgnored(t.el, 'text-overlap') && RL.effectiveOpacity(t.el) >= 0.3);
    const reported = new Set();
    spatialPairs(texts, (t) => t.vis, (a, b, ra, rb, inter) => {
      if (a.node === b.node) return;
      const minH = Math.min(ra.h, rb.h), minW = Math.min(ra.w, rb.w);
      if (inter.w <= 3 || inter.h < minH * 0.5 || inter.w < Math.min(minW * 0.15, 8)) return;
      const key = RL.selector(a.el) + '|' + RL.selector(b.el);
      if (reported.has(key)) return true;
      const { stack } = RL.stackAt(inter.x + inter.w / 2, inter.y + inter.h / 2);
      if (occludedBetween(stack, a.el, b.el)) return true;
      reported.add(key);
      const inSvg = a.el.namespaceURI === 'http://www.w3.org/2000/svg' || b.el.namespaceURI === 'http://www.w3.org/2000/svg';
      ctx.report({
        rule: 'text-overlap', el: a.el, related: b.el,
        message: (inSvg ? 'Chart/diagram labels collide: ' : 'Text overlaps other text: ') +
          '"' + RL.snippet(a.node, 30) + '" and "' + RL.snippet(b.node, 30) + '" overlap by ' + Math.round(inter.w) + '×' + Math.round(inter.h) + 'px.',
        details: { overlap: { w: Math.round(inter.w), h: Math.round(inter.h) }, svg: inSvg },
      });
      return true;
    });
  },
});

// ---------------------------------------------------------------------------
// Two pieces of text from independently placed layers (absolute/fixed) that sit
// side by side on the same surface, nearly touching and out of line with each
// other: a centred empty-state message drifting into a header pinned top-left.
// Nothing in the layout keeps them apart, so at another width they collide.
// Real overlap is text-overlap's job.
const NEAR_SVG = 'http://www.w3.org/2000/svg';
function placedLayer(el, stop) {
  for (let n = el; n && n !== stop; n = RL.parentOf(n)) {
    const p = RL.cs(n).position;
    if (p === 'absolute' || p === 'fixed') return n;
  }
  return null;
}
// The layer is placed against a box that is little more than the other text
// (a "NEW" on "Inbox", a superscript on a heading, a unit after a price): the
// two move together, so they can't drift into each other.
function anchoredTo(layer, other) {
  if (RL.cs(layer).position !== 'absolute') return false; // fixed: placed against the screen
  const cb = layer.offsetParent;
  if (!cb || cb === document.body || cb === document.documentElement || !RL.containsComposed(cb, other.el)) return false;
  const r = cb.getBoundingClientRect(), b = other.box;
  return r.height <= Math.max(b.h * 1.6, b.h + 12);
}
function drawnBetween(el, stop) {
  for (let n = el; n && n !== stop; n = RL.parentOf(n)) if (RL.hasVisibleBoundary(n)) return true;
  return false;
}
function readable(t) {
  if ((t.text.match(/\p{L}/gu) || []).length < 2) return false; // counts, bullets, arrows, glyphs
  if (t.el.namespaceURI === NEAR_SVG || (t.el.closest && t.el.closest('svg'))) return false; // charts: text-overlap
  const s = RL.cs(t.el);
  if (/icon|symbol|awesome|glyph/i.test(s.fontFamily)) return false; // icon-font ligatures
  return true;
}
RL.rule({
  id: 'text-near-overlap',
  order: 90.5,
  run(ctx) {
    const texts = ctx.texts.filter((t) => readable(t) && !RL.isIgnored(t.el, 'text-near-overlap') && RL.effectiveOpacity(t.el) >= 0.3);
    const fs = (el) => parseFloat(RL.cs(el).fontSize) || 16;
    const reach = (t) => Math.max(4, fs(t.el) * 0.75);
    const grown = new Map(texts.map((t) => {
      const g = reach(t);
      return [t, t.vis.map((r) => ({ x: r.x - g, y: r.y, w: r.w + 2 * g, h: r.h, right: r.right + g, bottom: r.bottom }))];
    }));
    const reported = new Set();
    spatialPairs(texts, (t) => grown.get(t), (a, b) => {
      if (a.el === b.el) return;
      const f = Math.min(fs(a.el), fs(b.el));
      const maxGap = Math.max(4, f * 0.75), tol = Math.max(2, f * 0.15);
      let hit = null;
      for (const ra of a.vis) {
        for (const rb of b.vis) {
          const vo = Math.min(ra.bottom, rb.bottom) - Math.max(ra.y, rb.y);
          if (vo < Math.min(ra.h, rb.h) * 0.3) continue; // not side by side
          const gap = Math.max(ra.x, rb.x) - Math.min(ra.right, rb.right);
          if (gap < -3 || gap > maxGap) continue; // a real overlap, or apart
          const dt = Math.abs(ra.y - rb.y), db = Math.abs(ra.bottom - rb.bottom);
          const dc = Math.abs((ra.y + ra.bottom) / 2 - (rb.y + rb.bottom) / 2);
          if (Math.min(dt, db, dc) <= tol) continue; // lined up: placed there on purpose
          hit = { gap: Math.max(0, Math.round(gap)), offset: Math.round(dc) };
          break;
        }
        if (hit) break;
      }
      if (!hit) return;
      const common = RL.commonAncestor(a.el, b.el);
      const la = placedLayer(a.el, common), lb = placedLayer(b.el, common);
      if (!la && !lb) return true; // one flow: the layout keeps them apart
      if ((!la || anchoredTo(la, b)) && (!lb || anchoredTo(lb, a))) return true; // one is placed against the other
      if (drawnBetween(a.el, common) || drawnBetween(b.el, common)) return true; // on its own badge, bubble or chip
      const key = RL.selector(a.el) + '|' + RL.selector(b.el);
      if (reported.has(key)) return true;
      reported.add(key);
      const [first, second] = a.vis[0].x <= b.vis[0].x ? [a, b] : [b, a];
      ctx.report({
        rule: 'text-near-overlap', el: first.el, related: second.el,
        message: '"' + RL.snippet(first.node, 30) + '" and "' + RL.snippet(second.node, 30) + '" sit side by side ' + hit.gap + 'px apart, ' + hit.offset +
          'px out of line, ' + (la && lb ? 'in separately positioned layers' : 'one of them in a positioned layer') + ': nothing keeps them apart, so they run into each other at other sizes.',
        details: { gap: hit.gap, offset: hit.offset, layer: RL.selector(la || lb) },
      });
      return true;
    });
  },
});

// ---------------------------------------------------------------------------
function chainUpTo(el, ancestor) {
  const out = [];
  for (let n = el; n && n !== ancestor; n = RL.parentOf(n)) out.push(n);
  return out;
}
function commonAncestor(a, b) {
  const set = new Set();
  for (let n = a; n; n = RL.parentOf(n)) set.add(n);
  for (let n = b; n; n = RL.parentOf(n)) if (set.has(n)) return n;
  return null;
}
function intentionalStacking(chain) {
  for (const n of chain) {
    const s = RL.cs(n);
    if (s.position === 'absolute' || s.position === 'fixed' || s.position === 'sticky') return 'positioned';
    if (s.transform !== 'none' || s.translate !== 'none' || s.rotate !== 'none' || s.scale !== 'none') return 'transform';
    if (parseFloat(s.marginTop) < 0 || parseFloat(s.marginLeft) < 0 || parseFloat(s.marginRight) < 0 || parseFloat(s.marginBottom) < 0) return 'negative-margin';
    if (s.float !== 'none') return 'float';
    if (s.position === 'relative' && ((parseFloat(s.top) || 0) !== 0 || (parseFloat(s.left) || 0) !== 0 || (parseFloat(s.bottom) || 0) !== 0)) return 'offset';
    const p = RL.parentOf(n);
    if (p && /grid/.test(RL.cs(p).display) && (s.gridRowStart !== 'auto' || s.gridColumnStart !== 'auto')) return 'grid-placement';
  }
  return null;
}

function isAdornment(field, el) {
  if (!RL.isTextField(field)) return false;
  const f = field.getBoundingClientRect(), r = el.getBoundingClientRect();
  return r.left >= f.left - 1 && r.right <= f.right + 1 && r.top >= f.top - 1 && r.bottom <= f.bottom + 1;
}

RL.rule({
  id: 'element-overlap',
  order: 91,
  run(ctx) {
    let solids = ctx.elements.filter((el) => {
      if (el === document.body || el === document.documentElement) return false;
      if (!RL.isSolid(el) || !RL.isVisible(el)) return false;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg' && el.tagName.toLowerCase() !== 'svg') return false;
      const r = el.getBoundingClientRect();
      return r.width >= 8 && r.height >= 8 && !RL.isIgnored(el, 'element-overlap');
    });
    // Only the visible part of each box counts: content scrolled/clipped out of view can't overlap anything.
    const rects = new Map();
    for (const el of solids) {
      const clip = RL.clipBoxOf(RL.parentOf(el));
      const r = clip ? RL.intersect(RL.rectOf(el), clip) : RL.rectOf(el);
      if (r && r.w >= 4 && r.h >= 4) rects.set(el, r);
    }
    solids = solids.filter((el) => rects.has(el));
    const reported = [];
    spatialPairs(solids, (el) => [rects.get(el)], (a, b, ra, rb, inter) => {
      if (RL.containsComposed(a, b) || RL.containsComposed(b, a)) return true;
      if (inter.w <= 3 || inter.h <= 3) return true;
      const ca = commonAncestor(a, b);
      const why = intentionalStacking(chainUpTo(a, ca)) || intentionalStacking(chainUpTo(b, ca));
      if (why && !(why === 'positioned' && RL.isInteractive(a) && RL.isInteractive(b))) return true;
      // A positioned button inside a text field's box (show-password, clear) is an adornment;
      // if it covers the text area, input-icon-overlap reports that.
      if (why === 'positioned' && (isAdornment(a, b) || isAdornment(b, a))) return true;
      if (reported.some(([x, y]) => (RL.containsComposed(x, a) && RL.containsComposed(y, b)) || (RL.containsComposed(x, b) && RL.containsComposed(y, a)))) return true;
      reported.push([a, b]);
      ctx.report({
        rule: 'element-overlap', el: a, related: b,
        message: 'Element overlaps a neighbouring element by ' + Math.round(inter.w) + '×' + Math.round(inter.h) + 'px.',
        details: { overlap: { w: Math.round(inter.w), h: Math.round(inter.h) } },
      });
      return true;
    });
  },
});

// ---------------------------------------------------------------------------
RL.rule({
  id: 'obscured-content',
  order: 92,
  run(ctx) {
    const targets = [];
    const seenEl = new Set();
    for (const t of ctx.texts) {
      if (seenEl.has(t.el)) continue;
      seenEl.add(t.el);
      const r = t.vis[0];
      targets.push({ el: t.el, x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'text' });
    }
    for (const el of ctx.elements) {
      if (!RL.isInteractive(el) || seenEl.has(el) || !RL.isVisible(el)) continue;
      const clip = RL.clipBoxOf(RL.parentOf(el));
      const r = clip ? RL.intersect(RL.rectOf(el), clip) : RL.rectOf(el);
      if (!r || r.w < 2 || r.h < 2) continue;
      targets.push({ el, x: r.x + r.w / 2, y: r.y + r.h / 2, kind: 'control' });
    }
    targets.sort((a, b) => a.y - b.y);
    const vpArea = innerWidth * innerHeight;
    const reported = new Set();
    let checks = 0;
    for (const tg of targets) {
      if (checks++ > 2500) break;
      if (RL.isIgnored(tg.el, 'obscured-content')) continue;
      const { stack, scrolled } = RL.stackAt(tg.x, tg.y);
      const idx = stack.findIndex((e) => e === tg.el || RL.containsComposed(tg.el, e));
      if (idx <= 0) continue;
      for (let k = 0; k < idx; k++) {
        const e = stack[k];
        if (RL.containsComposed(e, tg.el) || RL.containsComposed(tg.el, e)) continue;
        if (RL.isDevTool(e) || (e.closest && e.closest('nextjs-portal,vite-error-overlay,astro-dev-toolbar'))) continue;
        if (!RL.isOpaqueLayer(e)) continue;
        if (RL.isIgnored(e, 'obscured-content')) break;
        // Layered illustrations / mockups (stacked absolutely positioned or transformed cards) are deliberate.
        if (RL.layeredBetween(tg.el, RL.commonAncestor(tg.el, e))) break;
        const fixed = RL.fixedAncestor(e);
        const tgFixed = RL.fixedAncestor(tg.el);
        if (fixed && !tgFixed && scrolled) break; // header over content only because we scrolled
        if (fixed) {
          const fr = fixed.getBoundingClientRect();
          if (fr.width * fr.height > vpArea * 0.5) break; // modal / backdrop
        }
        const key = RL.selector(e) + '>' + RL.selector(RL.nearestBlock(tg.el));
        if (reported.has(key)) break;
        reported.add(key);
        ctx.report({
          rule: 'obscured-content', el: tg.el, related: e,
          message: (tg.kind === 'control' ? 'Interactive element' : 'Text') + ' is hidden underneath another element' + (fixed ? ' (a fixed/sticky layer)' : '') + '.',
          details: { kind: tg.kind, coveredBy: e.tagName.toLowerCase() },
        });
        break;
      }
    }
  },
});
