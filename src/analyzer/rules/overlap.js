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
