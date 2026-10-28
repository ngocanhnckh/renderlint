// Contrast without pixels. Most text sits on a flat background colour that the computed
// styles prove: an opaque background-color on an ancestor, nothing painted between it and
// the text, nothing else painted over the text's box, and no effect (opacity, filter, blend
// mode, mask...) that changes the colour. For such text the Node runner computes the ratio
// directly and only captures the page for the rest. Anything that cannot be proven goes to
// the screenshot path: this classifier must never say "solid" when pixels would disagree.
//
// RL.solidBackgrounds(cands) sets cand.bg = {r, g, b, slack} (the colour a capture of the
// page without text would show under every sample point) on the candidates it can prove.
// slack > 0: the colour composites translucent layers, which the compositor rounds its own
// way (up to ±slack per channel): it only proves that text passes, never a finding.
// Translucent text and opacity on the text's ancestors below the background are fine: the
// pixel path also computes the text colour from styles. Otherwise cand.why says what failed.

const RGB_RE = /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d*\.?\d+))?\)$/;
// Only plain sRGB computed colours: oklch(), color-mix(), color() etc. go through a gamut
// mapping the compositor may not share with our conversion.
function rgbOf(str) {
  const m = RGB_RE.exec(str);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : undefined;
}
const px = (v) => parseFloat(v) || 0;
const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'METER', 'PROGRESS']);
const REPLACED_TAGS = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'PICTURE', 'svg', 'SVG', 'AUDIO', 'MATH', 'math']);
const BIG = 1e7;
const SVG_SHAPES = new Set(['rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path', 'image', 'use']);
const SVG_TEXT = new Set(['text', 'tspan', 'textPath']);
// The outermost <svg> (in an HTML document: the one whose parent isn't SVG).
const isSvgRoot = (el) => el.tagName.toLowerCase() === 'svg' && !(el.parentNode && el.parentNode.namespaceURI === SVG_NS);
function outerSvg(el) {
  let n = el;
  while (n && !(n.namespaceURI === SVG_NS && isSvgRoot(n))) n = n.parentNode;
  return n;
}

function hasBorder(s) {
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    if (px(s['border' + side + 'Width']) > 0 && s['border' + side + 'Style'] !== 'none' && s['border' + side + 'Style'] !== 'hidden') return true;
  }
  return false;
}
function hasOutline(s) { return s.outlineStyle !== 'none' && px(s.outlineWidth) > 0; }
// How far a box-shadow / filter / outline can paint outside the border box (an upper bound:
// the sum of every length in it).
function lengthsExtent(str) {
  let sum = 0;
  for (const m of String(str).matchAll(/(-?[\d.]+)px/g)) sum += Math.abs(+m[1]);
  return sum;
}
function effectsOf(s) {
  return s.mixBlendMode !== 'normal' || (s.filter && s.filter !== 'none') || (s.backdropFilter && s.backdropFilter !== 'none') ||
    (s.webkitBackdropFilter && s.webkitBackdropFilter !== 'none') || (s.maskImage && s.maskImage !== 'none') ||
    (s.webkitMaskImage && s.webkitMaskImage !== 'none') || (s.clipPath && s.clipPath !== 'none') ||
    (s.webkitBoxReflect && s.webkitBoxReflect !== 'none');
}
// Transforms that keep boxes axis-aligned (their client rects are then exact).
function plainTransform(t) {
  if (!t || t === 'none') return true;
  const m = /^matrix\(([^)]*)\)$/.exec(t);
  if (!m) return false;
  const v = m[1].split(',').map(Number);
  return v[1] === 0 && v[2] === 0 && v[0] > 0 && v[3] > 0;
}

const grow = (r, d) => ({ x: r.x - d, y: r.y - d, right: r.right + d, bottom: r.bottom + d });
const overlaps = (a, b) => a.x < b.right && b.x < a.right && a.y < b.bottom && b.y < a.bottom;
const inside = (a, b) => a.x >= b.x && a.right <= b.right && a.y >= b.y && a.bottom <= b.bottom;

// Is rect a inside box b with rounded corners? (radii in px; a rounded rect is convex, so
// it is enough that a's corners are inside.)
// The radii of the box's border edge (b: its border box, w × h), scaled down like CSS does
// when adjacent ones don't fit; null when they can't be known.
function radiiOf(s, w, h) {
  const out = [];
  for (const rad of [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomRightRadius, s.borderBottomLeftRadius]) {
    if (!rad || rad === '0px') { out.push([0, 0]); continue; }
    const parts = rad.split(' ');
    const pr = (v, of) => (/%$/.test(v) ? parseFloat(v) / 100 * of : /px$/.test(v) ? px(v) : NaN);
    const rx = pr(parts[0], w), ry = pr(parts[1] !== undefined ? parts[1] : parts[0], h);
    if (isNaN(rx) || isNaN(ry)) return null;
    out.push([rx, ry]);
  }
  const [tl, tr, br, bl] = out;
  const f = Math.min(1, w / (tl[0] + tr[0] || 1), w / (bl[0] + br[0] || 1), h / (tl[1] + bl[1] || 1), h / (tr[1] + br[1] || 1));
  return out.map(([x, y]) => [x * f, y * f]);
}

// Is rect a inside box b with the rounded corners of the border box outer (style s)? Radii
// of the outer edge are used for inner edges too (larger: a safe bound). A rounded rect is
// convex, so it is enough that a's corners are inside.
function insideRounded(a, b, s, outer) {
  if (!inside(a, b)) return false;
  outer = outer || b;
  const radii = radiiOf(s, outer.right - outer.x, outer.bottom - outer.y);
  if (!radii) return false;
  const corners = [
    [radii[0], a.x, a.y, b.x, b.y, 1, 1],
    [radii[1], a.right, a.y, b.right, b.y, -1, 1],
    [radii[2], a.right, a.bottom, b.right, b.bottom, -1, -1],
    [radii[3], a.x, a.bottom, b.x, b.bottom, 1, -1],
  ];
  for (const [[rx, ry], x, y, bx, by, sx, sy] of corners) {
    if (!rx || !ry) continue;
    const cx = bx + sx * rx, cy = by + sy * ry;
    const dx = (x - cx) * sx, dy = (y - cy) * sy;
    // the point is in the corner square, outside the quarter ellipse (plus a pixel of anti-aliasing)
    if (dx < 0 && dy < 0) {
      const ex = -dx / rx, ey = -dy / ry;
      if (Math.hypot(ex, ey) > 1 - 1.5 / Math.max(rx, ry)) return false;
    }
  }
  return true;
}

// Border box fragments of an element (inline elements have one per line).
function boxesOf(el) {
  const s = RL.cs(el);
  if (s.display === 'inline') return Array.from(el.getClientRects()).map(RL.docRect);
  return [RL.docRect(el.getBoundingClientRect())];
}
const shrink = (r, t, rt, b, l) => ({ x: r.x + l, y: r.y + t, right: r.right - rt, bottom: r.bottom - b });
function paddingBoxOf(r, s) { return shrink(r, px(s.borderTopWidth), px(s.borderRightWidth), px(s.borderBottomWidth), px(s.borderLeftWidth)); }
function contentBoxOf(r, s) {
  const p = paddingBoxOf(r, s);
  return shrink(p, px(s.paddingTop), px(s.paddingRight), px(s.paddingBottom), px(s.paddingLeft));
}

// Creates a containing block for absolutely (or, when fixed, fixed) positioned descendants.
function isContainingBlock(s, fixed) {
  if (!fixed && s.position !== 'static') return true;
  return (s.transform && s.transform !== 'none') || (s.filter && s.filter !== 'none') || (s.perspective && s.perspective !== 'none') ||
    /paint|layout|strict|content/.test(s.contain || '') || /transform|filter|perspective/.test(s.willChange || '') ||
    (s.backdropFilter && s.backdropFilter !== 'none') || (s.containerType && s.containerType !== 'normal');
}

// Region a ::before/::after can paint into, or null when it paints nothing. A region we
// cannot bound covers the whole page.
const EVERYWHERE = { x: -BIG, y: -BIG, right: BIG, bottom: BIG };
function pseudoRegion(el, which, elBox) {
  const s = getComputedStyle(el, which);
  if (!s.content || s.content === 'none' || s.content === 'normal' || s.display === 'none') return null;
  const borders = hasBorder(s);
  const bg = RL.parseColor(s.backgroundColor);
  const paints = (bg && bg.a > 0) || s.backgroundImage !== 'none' || borders || s.boxShadow !== 'none' || hasOutline(s) ||
    /url\(|image|gradient/.test(s.content) || px(s.webkitTextStrokeWidth) > 0 || effectsOf(s);
  if (!paints) return null;
  if (s.visibility !== 'visible') return null;
  let r;
  const fixed = s.position === 'fixed';
  if (s.position === 'absolute' || fixed) {
    let cb = null, cbStyle = null;
    for (let n = el; n; n = RL.parentOf(n)) {
      const ns = RL.cs(n);
      if (isContainingBlock(ns, fixed)) { cb = n; cbStyle = ns; break; }
    }
    let origin;
    if (cb) {
      let cbBox = RL.docRect(cb.getBoundingClientRect());
      if (cbStyle.display === 'inline') {
        // an inline containing block on one line is its box; over several lines it's ambiguous
        const frags = cb.getClientRects();
        if (frags.length !== 1) return EVERYWHERE;
        cbBox = RL.docRect(frags[0]);
      }
      origin = paddingBoxOf(cbBox, cbStyle);
      if (!plainTransform(cbStyle.transform)) return EVERYWHERE;
    } else origin = fixed ? { x: scrollX, y: scrollY } : { x: 0, y: 0 };
    const w = px(s.width) + px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth);
    const h = px(s.height) + px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth);
    if (!/px$/.test(s.left) || !/px$/.test(s.top) || !/px$/.test(s.width) || !/px$/.test(s.height)) return EVERYWHERE;
    const x = origin.x + px(s.left) + px(s.marginLeft), y = origin.y + px(s.top) + px(s.marginTop);
    r = { x, y, right: x + w, bottom: y + h };
    if (s.transform && s.transform !== 'none') {
      const m = /^matrix\(([^)]*)\)$/.exec(s.transform);
      if (!m) return EVERYWHERE;
      const [a, b, c, d, e, f] = m[1].split(',').map(Number);
      const o = s.transformOrigin.split(' ').map(px);
      const ox = r.x + o[0], oy = r.y + o[1];
      const pts = [[r.x, r.y], [r.right, r.y], [r.x, r.bottom], [r.right, r.bottom]].map(([X, Y]) => {
        const dx = X - ox, dy = Y - oy;
        return [ox + a * dx + c * dy + e, oy + b * dx + d * dy + f];
      });
      r = { x: Math.min(...pts.map((p) => p[0])), y: Math.min(...pts.map((p) => p[1])), right: Math.max(...pts.map((p) => p[0])), bottom: Math.max(...pts.map((p) => p[1])) };
    }
  } else {
    // In flow: inside the element's box, unless it overflows (bounded by its own size) or is moved.
    const es = RL.cs(el);
    let d = es.overflowX !== 'visible' && es.overflowY !== 'visible' ? 0 : px(s.width) + px(s.height) + px(s.paddingLeft) + px(s.paddingRight) + px(s.paddingTop) + px(s.paddingBottom);
    if (s.transform && s.transform !== 'none') return EVERYWHERE;
    if (s.position === 'relative' || s.position === 'sticky') d += Math.abs(px(s.top)) + Math.abs(px(s.left)) + Math.abs(px(s.bottom)) + Math.abs(px(s.right));
    for (const m of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft']) if (px(s[m]) < 0) d -= px(s[m]);
    if (!/px$/.test(s.width) && s.display !== 'inline') d += BIG; // can't bound it
    r = grow(elBox, d);
  }
  return grow(r, lengthsExtent(s.boxShadow) + (hasOutline(s) ? px(s.outlineWidth) + Math.abs(px(s.outlineOffset)) : 0) + lengthsExtent(s.filter) * 3 + 1);
}

// Everything (other than text) that paints, with the region it can paint into, in a grid.
const PAINT_CELL = 128;
function paintIndex() {
  const grid = new Map(), wide = [];
  const add = (el, r, pseudo) => {
    const item = { el, r, pseudo };
    if ((r.right - r.x) * (r.bottom - r.y) > 4e6 || r.right - r.x > 1e5 || r.bottom - r.y > 1e5) { wide.push(item); return; }
    for (let gx = Math.floor(r.x / PAINT_CELL); gx <= Math.floor(r.right / PAINT_CELL); gx++) {
      for (let gy = Math.floor(r.y / PAINT_CELL); gy <= Math.floor(r.bottom / PAINT_CELL); gy++) {
        const k = gx + ',' + gy;
        let list = grid.get(k);
        if (!list) grid.set(k, (list = []));
        list.push(item);
      }
    }
  };
  const unseen = new Set(); // opacity: 0 paints nothing, nor does anything inside it
  for (const el of RL.allElements()) {
    const s = RL.cs(el);
    if (s.display === 'none') continue;
    if (s.opacity === '0' || unseen.has(RL.parentOf(el))) { unseen.add(el); continue; }
    const isSvg = el.namespaceURI === SVG_NS;
    if (isSvg && !isSvgRoot(el)) {
      // shapes inside an <svg> (its text is hidden in the text-free capture, so isn't one)
      if (!SVG_SHAPES.has(el.tagName) || s.visibility !== 'visible' || (s.fill === 'none' && s.stroke === 'none')) continue;
      const box = RL.docRect(el.getBoundingClientRect());
      if (box.w + box.h <= 0) continue; // in <defs>, <clipPath>...
      const marker = [s.markerStart, s.markerMid, s.markerEnd].some((m) => m && m !== 'none');
      let r = marker ? EVERYWHERE : grow(box, (s.stroke !== 'none' ? 4 * px(s.strokeWidth) : 0) + lengthsExtent(s.filter) * 3 + 1);
      // clipped to the outer <svg> (overflow: hidden is the default for inline svg)
      const root = el.ownerSVGElement && outerSvg(el);
      if (root) {
        const rs = RL.cs(root);
        if (rs.overflow !== 'visible') {
          const rb = RL.docRect(root.getBoundingClientRect());
          r = { x: Math.max(r.x, rb.x - 1), y: Math.max(r.y, rb.y - 1), right: Math.min(r.right, rb.right + 1), bottom: Math.min(r.bottom, rb.bottom + 1) };
          if (r.right <= r.x || r.bottom <= r.y) continue;
        }
      }
      add(el, r, false);
      continue;
    }
    const box = RL.docRect(el.getBoundingClientRect());
    if (s.display !== 'contents') {
      const visible = s.visibility === 'visible';
      const bg = RL.parseColor(s.backgroundColor);
      const listItem = s.display === 'list-item' && (s.listStyleType !== 'none' || s.listStyleImage !== 'none');
      const scrollbar = (s.overflowX !== 'visible' || s.overflowY !== 'visible') && !isSvg &&
        (el.offsetWidth - el.clientWidth - px(s.borderLeftWidth) - px(s.borderRightWidth) > 0 || el.offsetHeight - el.clientHeight - px(s.borderTopWidth) - px(s.borderBottomWidth) > 0);
      const paints = visible && ((bg && bg.a > 0) || s.backgroundImage !== 'none' || hasBorder(s) || s.boxShadow !== 'none' || hasOutline(s) ||
        REPLACED_TAGS.has(el.tagName) || CONTROL_TAGS.has(el.tagName) || el.tagName === 'HR' || scrollbar ||
        px(s.webkitTextStrokeWidth) > 0 || (s.backdropFilter && s.backdropFilter !== 'none') || (s.columnRuleStyle && s.columnRuleStyle !== 'none') ||
        (s.webkitBoxReflect && s.webkitBoxReflect !== 'none') || (s.filter && s.filter !== 'none'));
      if (paints && box.w + box.h > 0) {
        let d = lengthsExtent(s.boxShadow) + (hasOutline(s) ? px(s.outlineWidth) + Math.abs(px(s.outlineOffset)) : 0) + lengthsExtent(s.filter) * 3 + 1;
        if (s.webkitBoxReflect && s.webkitBoxReflect !== 'none') d = BIG;
        let r = grow(box, d);
        if (isSvg && s.overflow === 'visible') r = grow(r, Math.max(box.w, box.h) + 8);
        add(el, r, false);
      }
      if (listItem && visible && box.w + box.h > 0) {
        // the marker (bullets are drawn as shapes, not text): beside the first line, outside
        // the content box unless list-style-position is inside
        const fs = px(s.fontSize) || 16, cb = contentBoxOf(box, s);
        const rtl = s.direction === 'rtl', inner = s.listStylePosition === 'inside';
        const edge = rtl ? cb.right : cb.x, dir = rtl ? -1 : 1;
        const a = inner ? edge - dir : edge - dir * 4 * fs, b = inner ? edge + dir * 3 * fs : edge - dir * 2;
        let r = { x: Math.min(a, b), right: Math.max(a, b), y: cb.y - 1, bottom: cb.y + Math.max(px(s.lineHeight) || 0, 2 * fs) + 1 };
        if (s.listStyleImage !== 'none') r = grow(r, 100);
        add(el, r, true);
      }
    }
    if (!isSvg) {
      for (const which of ['::before', '::after']) {
        const r = pseudoRegion(el, which, box);
        if (r) add(el, r, true);
      }
    }
  }
  return {
    query(r) {
      const out = new Set(wide);
      for (let gx = Math.floor(r.x / PAINT_CELL); gx <= Math.floor(r.right / PAINT_CELL); gx++) {
        for (let gy = Math.floor(r.y / PAINT_CELL); gy <= Math.floor(r.bottom / PAINT_CELL); gy++) {
          for (const it of grid.get(gx + ',' + gy) || []) out.add(it);
        }
      }
      return out;
    },
  };
}

// The canvas colour when neither <html> nor <body> paints one: white, unless the page may be dark.
// The page opts into dark through the color-scheme property or <meta name="color-scheme">.
function canvasColor() {
  const meta = document.querySelector('meta[name="color-scheme" i]');
  const scheme = (RL.cs(document.documentElement).colorScheme || '') + ' ' + (meta ? meta.content : '');
  if (!/dark/.test(scheme)) return { r: 255, g: 255, b: 255, a: 1 };
  return !matchMedia('(prefers-color-scheme: dark)').matches && /light|normal/.test(scheme) ? { r: 255, g: 255, b: 255, a: 1 } : null;
}

const firstLineCache = new Map();
function firstLinePaints(n) {
  if (firstLineCache.has(n)) return firstLineCache.get(n);
  let v = false;
  for (const which of ['::first-line', '::first-letter']) {
    const s = getComputedStyle(n, which);
    const bg = RL.parseColor(s.backgroundColor);
    if ((bg && bg.a > 0) || s.backgroundImage !== 'none' || hasBorder(s) || s.boxShadow !== 'none' || px(s.webkitTextStrokeWidth) > 0) v = true;
  }
  firstLineCache.set(n, v);
  return v;
}

// Parent in the flat tree: slotted content paints inside the shadow tree's wrappers.
const flatParent = (n) => n.assignedSlot || RL.parentOf(n);

// Why the last candidate went to pixels (reported in RENDERLINT_CONTRAST_CHECK runs).
let why = '';
const no = (reason) => { why = reason; return null; };

// The flat colour under every one of the text's (pixel-snapped) rects, or null.
function solidBackground(c, index, W) {
  const el = c.el;
  if (c.complex || !c.color) return no('complex');
  if (el.namespaceURI === SVG_NS && !SVG_TEXT.has(el.tagName)) return no('svg');
  if (CONTROL_TAGS.has(el.tagName)) {
    // native controls paint their own field/arrow; only a styled-away select is plain
    if (el.tagName === 'SELECT' && RL.cs(el).appearance !== 'none') return no('select');
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return no('control');
    if (el.tagName === 'INPUT' && (!/^(text|email|password|tel|url)$/.test(el.type) || el.list)) return no('input-type');
  }
  // a text stroke and glyphs that keep their own colours (emoji) stay visible in the text-free capture
  if (px(RL.cs(el).webkitTextStrokeWidth) > 0) return no('text-stroke');
  RL.EMOJI_RE.lastIndex = 0;
  if (RL.EMOJI_RE.test(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ? (el.value || el.placeholder || '') : el.textContent || '')) return no('emoji');
  const rects = [];
  for (const r of c.rects) {
    const s = { x: Math.max(0, Math.floor(r.x)), y: Math.max(0, Math.floor(r.y)), right: Math.min(W, Math.ceil(r.x + r.w)), bottom: Math.ceil(r.y + r.h) };
    if (s.right > s.x && s.bottom > s.y) rects.push(s);
  }
  if (!rects.length) return no('no-rects');
  const de = document.documentElement, body = document.body;
  const htmlStyle = RL.cs(de);
  const htmlBg = rgbOf(htmlStyle.backgroundColor);
  const bodyIsCanvas = htmlBg && htmlBg.a === 0 && htmlStyle.backgroundImage === 'none';

  const chain = new Set();
  const layers = []; // translucent backgrounds above the base, nearest the text first
  let base = null;
  for (let n = el; n; n = flatParent(n)) {
    const s = RL.cs(n);
    if (effectsOf(s)) return no('effects');
    // a defined custom element without an open shadow root may render through a closed one we can't see
    if (n.localName.includes('-') && !n.shadowRoot && window.customElements && customElements.get(n.localName)) return no('closed-shadow');
    if (n.namespaceURI === SVG_NS && !isSvgRoot(n)) {
      // inside an <svg>: no box of its own to paint (the shapes are in the paint index)
      if (!plainTransform(s.transform)) return no('transform');
      if (s.opacity !== '' && px(s.opacity) < 1 && layers.length) return no('faded-bg');
      chain.add(n);
      continue;
    }
    if (s.zIndex && s.zIndex[0] === '-') return no('z-negative');
    if (!plainTransform(s.transform)) return no('transform');
    if (/text/.test(s.backgroundClip || '') || /text/.test(s.webkitBackgroundClip || '')) return no('bg-clip-text');
    const isRoot = n === de, isCanvas = isRoot || (n === body && bodyIsCanvas);
    if (base) {
      // above the base: only effects that change the composited colour (checked above), opacity, and outlines over the text
      if (px(s.opacity) < 1 && s.opacity !== '') return no('opacity-above');
      if (hasOutline(s) && !isRoot) {
        const box = RL.docRect(n.getBoundingClientRect());
        if (px(s.outlineOffset) < 0 || rects.some((r) => !inside(r, box) && overlaps(r, grow(box, px(s.outlineWidth) + px(s.outlineOffset) + 1)))) return no('outline-above');
      }
      // an ancestor that clips its content cuts the background off at its padding box (rounded
      // by its radius): beyond it, its own border or what's behind shows
      const toViewport = isRoot || (n === body && htmlStyle.overflowX === 'visible' && htmlStyle.overflowY === 'visible');
      if (!toViewport && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
        const box = RL.docRect(n.getBoundingClientRect());
        if (rects.some((r) => !insideRounded(r, paddingBoxOf(box, s), s, box))) return no('clipped-above');
      }
      continue;
    }
    chain.add(n);
    if (!RL.isInline(n) && firstLinePaints(n)) return no('first-line');
    // opacity fades what this element paints and what's inside it: fine for the text alone
    const faded = s.opacity !== '' && px(s.opacity) < 1;
    const bg = s.backgroundColor === 'rgba(0, 0, 0, 0)' ? { r: 0, g: 0, b: 0, a: 0 } : rgbOf(s.backgroundColor);
    if (!bg) return no('bg-format');
    if (s.backgroundImage !== 'none') return no('bg-image');
    if (s.visibility !== 'visible' && bg.a > 0) return no('bg-hidden');
    if (isCanvas) {
      // the root background paints the whole canvas, over the default (white) one
      if (faded) return no('canvas-faded');
      if (n === body && (hasBorder(s) || hasOutline(s) || s.boxShadow !== 'none')) return no('body-border');
      if (n === body && bg.a === 0) continue; // transparent <html> comes next
      if (bg.a >= 1) { base = bg; continue; }
      if (bg.a > 0) layers.push(bg);
      if (!(base = canvasColor())) return no('canvas-dark');
      continue;
    }
    const border = hasBorder(s), shadow = s.boxShadow !== 'none', outline = hasOutline(s);
    const scrolls = (s.overflowX !== 'visible' || s.overflowY !== 'visible') && s.display !== 'inline';
    if (faded && (bg.a > 0 || layers.length)) return no('faded-bg');
    if (bg.a === 0 && !border && !shadow && !outline && !scrolls) continue;
    if (/inset/.test(s.boxShadow)) return no('inset-shadow');
    if (CONTROL_TAGS.has(n.tagName) && n.tagName !== 'INPUT' && n.tagName !== 'TEXTAREA' && n.tagName !== 'BUTTON' && s.appearance !== 'none') return no('control-chain');
    if (n.tagName === 'BUTTON' && s.appearance !== 'none' && hasBorder(s) && /outset|inset/.test(s.borderTopStyle)) return no('native-button'); // native button look
    const boxes = boxesOf(n);
    if (!boxes.length) return no('no-boxes');
    // a (styled) scrollbar paints over the edge of the box: the text must stay in the client area
    let scrollbar = null;
    if (scrolls && (n.offsetWidth - n.clientWidth - px(s.borderLeftWidth) - px(s.borderRightWidth) > 0 || n.offsetHeight - n.clientHeight - px(s.borderTopWidth) - px(s.borderBottomWidth) > 0)) {
      const b = boxes[0];
      scrollbar = { x: b.x + n.clientLeft, y: b.y + n.clientTop, right: b.x + n.clientLeft + n.clientWidth, bottom: b.y + n.clientTop + n.clientHeight };
    }
    const extent = (shadow ? lengthsExtent(s.boxShadow) : 0) + (outline ? px(s.outlineWidth) + Math.max(0, px(s.outlineOffset)) : 0) + 1;
    if (outline && px(s.outlineOffset) < 0) return no('outline-neg');
    for (const r of rects) {
      if (bg.a > 0) {
        // the background must cover the rect: inside its painting area (and not under the border)
        const clip = s.backgroundClip;
        const ok = boxes.some((b) => {
          let area = border || clip === 'padding-box' ? paddingBoxOf(b, s) : b;
          if (clip === 'content-box') area = contentBoxOf(b, s);
          return insideRounded(r, area, s, b);
        });
        if (!ok) return no('bg-not-covering');
      } else if (border) {
        // a border that isn't under the text: rect inside the padding box, or clear of the box
        if (!boxes.every((b) => insideRounded(r, paddingBoxOf(b, s), s, b) || !overlaps(r, b))) return no('border-under');
      }
      if (scrollbar && !inside(r, scrollbar)) return no('scrollbar');
      if ((shadow || outline) && !boxes.some((b) => inside(r, b)) && boxes.some((b) => overlaps(r, grow(b, extent)))) return no('shadow-near');
    }
    if (bg.a === 0) continue;
    if (bg.a >= 1) base = bg;
    else layers.push(bg);
  }
  if (!base) return no('no-base');

  // anything else painting over the text's box (siblings, overlays, icons, pseudo-elements...)
  const baseEl = Array.from(chain).pop();
  for (const r of rects) {
    for (const it of index.query(r)) {
      if (!overlaps(r, it.r)) continue;
      if (!it.pseudo && (chain.has(it.el) || RL.containsComposed(it.el, baseEl))) continue; // the chain itself (checked above) or below the base
      return no('overlap' + (it.pseudo ? '-pseudo' : '') + (RL.containsComposed(el, it.el) ? '-inside' : RL.containsComposed(it.el, el) ? '-ancestor' : '') + ' ' + RL.selector(it.el).slice(-60));
    }
  }
  let out = base;
  for (let i = layers.length - 1; i >= 0; i--) out = RL.blend(layers[i], out);
  // The compositor blends translucent layers with its own rounding (up to ±2 per channel
  // seen with three layers): such a colour is only good to prove that text passes.
  return { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b), slack: layers.length ? 2 * layers.length + 1 : 0 };
}

RL.solidBackgrounds = function (cands) {
  firstLineCache.clear();
  // a text selection or a highlight paints behind text; a modal dialog's backdrop over everything
  const sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) return;
  if (window.CSS && CSS.highlights && CSS.highlights.size) return;
  try { if (document.querySelector(':modal, :fullscreen')) return; } catch (e) { /* old engine */ }
  if (!document.body) return;
  const W = document.documentElement.clientWidth;
  const index = paintIndex();
  for (const c of cands) {
    why = '';
    try { c.bg = solidBackground(c, index, W) || undefined; } catch (e) { c.bg = undefined; why = 'error: ' + e.message; }
    if (!c.bg) c.why = why;
  }
};
