// renderlint in-page core. This file (and the rule files) are concatenated into a
// single IIFE by src/analyzer/bundle.js and evaluated inside the rendered page.
// Everything shares the `RL` object defined by the bundle wrapper.

RL.rules = [];
RL.rule = function (def) { RL.rules.push(def); };

// ---------------------------------------------------------------------------
// Style / DOM helpers
// ---------------------------------------------------------------------------

const styleCache = new Map();
function cs(el) {
  let s = styleCache.get(el);
  if (!s) { s = getComputedStyle(el); styleCache.set(el, s); }
  return s;
}
RL.cs = cs;
RL.resetCaches = function () { styleCache.clear(); visCache.clear(); ignoreCache.clear(); if (typeof clipCache !== 'undefined') clipCache.clear(); };

function parentOf(el) {
  if (el.parentElement) return el.parentElement;
  const p = el.parentNode;
  return p && p.host ? p.host : null; // cross shadow-root boundary
}
RL.parentOf = parentOf;

function containsComposed(a, b) {
  // true if b is a (composed) descendant of a or equal to it
  for (let n = b; n; n = parentOf(n)) if (n === a) return true;
  return false;
}
RL.containsComposed = containsComposed;

function docRect(r) {
  return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height,
    right: r.right + scrollX, bottom: r.bottom + scrollY };
}
RL.docRect = docRect;
RL.rectOf = function (el) { return docRect(el.getBoundingClientRect()); };

function intersect(a, b) {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.right, b.right), btm = Math.min(a.bottom, b.bottom);
  if (r <= x || btm <= y) return null;
  return { x, y, w: r - x, h: btm - y, right: r, bottom: btm };
}
RL.intersect = intersect;

function unionRects(rects) {
  if (!rects.length) return null;
  let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity;
  for (const q of rects) { x = Math.min(x, q.x); y = Math.min(y, q.y); r = Math.max(r, q.right); b = Math.max(b, q.bottom); }
  return { x, y, w: r - x, h: b - y, right: r, bottom: b };
}
RL.unionRects = unionRects;

const INLINE_DISPLAYS = new Set(['inline', 'contents']);
RL.isInline = (el) => INLINE_DISPLAYS.has(cs(el).display);

function nearestBlock(el) {
  for (let n = el; n; n = parentOf(n)) {
    if (n.namespaceURI === 'http://www.w3.org/2000/svg') {
      if (n.tagName.toLowerCase() === 'svg') return n;
      continue;
    }
    if (!RL.isInline(n)) return n;
  }
  return document.body;
}
RL.nearestBlock = nearestBlock;

function isOutOfFlow(el) {
  const p = cs(el).position;
  return p === 'absolute' || p === 'fixed';
}
RL.isOutOfFlow = isOutOfFlow;

// Visible boundary = the box is visually distinguishable from its surroundings.
function hasVisibleBoundary(el) {
  if (el === document.body || el === document.documentElement) return false;
  const s = cs(el);
  if (s.backgroundImage && s.backgroundImage !== 'none') return true;
  const bg = RL.parseColor(s.backgroundColor);
  if (bg && bg.a > 0.05) return true;
  for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
    const w = parseFloat(s['border' + side + 'Width']);
    if (w > 0 && s['border' + side + 'Style'] !== 'none' && s['border' + side + 'Style'] !== 'hidden') {
      const c = RL.parseColor(s['border' + side + 'Color']);
      if (c && c.a > 0.05) return true;
    }
  }
  if (s.boxShadow && s.boxShadow !== 'none' && !/^rgba\(0, 0, 0, 0\)/.test(s.boxShadow)) return true;
  return false;
}
RL.hasVisibleBoundary = hasVisibleBoundary;

function clips(el, axis) {
  if (el === document.documentElement) return false;
  const s = cs(el);
  const v = axis === 'x' ? s.overflowX : s.overflowY;
  return v !== 'visible';
}
RL.clips = clips;
RL.isScrollContainer = function (el, axis) {
  const s = cs(el);
  const v = axis === 'x' ? s.overflowX : s.overflowY;
  return v === 'auto' || v === 'scroll';
};

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

const visCache = new Map();
function isVisible(el) {
  if (visCache.has(el)) return visCache.get(el);
  let v = true;
  if (!el.isConnected) v = false;
  else if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) v = false;
  else {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') v = false;
  }
  if (v && isVisuallyHidden(el)) v = false;
  visCache.set(el, v);
  return v;
}
RL.isVisible = isVisible;

// Screen-reader-only / off-screen patterns that are intentionally invisible.
function isVisuallyHidden(el) {
  for (let n = el, depth = 0; n && n !== document.body && depth < 40; n = parentOf(n), depth++) {
    if (n.namespaceURI === 'http://www.w3.org/2000/svg' && n.tagName.toLowerCase() !== 'svg') continue;
    const s = cs(n);
    const r = n.getBoundingClientRect();
    if ((r.width <= 2 || r.height <= 2) && s.overflow !== 'visible') return true;
    if (s.clip && s.clip !== 'auto' && /rect\(0(px)?,? 0(px)?/.test(s.clip)) return true;
    if (s.clipPath && /inset\((50|100)%/.test(s.clipPath)) return true;
    if (parseFloat(s.opacity) === 0) return true;
    if (s.position === 'absolute' || s.position === 'fixed') {
      // off-canvas / off-screen positioned content (e.g. left:-9999px, translateX(-100%))
      if (r.right <= 0 || r.bottom <= 0) return true;
      if (s.position === 'fixed' && (r.left >= innerWidth || r.top >= innerHeight)) return true;
      if (r.left >= document.documentElement.scrollWidth) return true;
    }
  }
  return false;
}
RL.isVisuallyHidden = isVisuallyHidden;

function effectiveOpacity(el) {
  let o = 1;
  for (let n = el; n; n = parentOf(n)) o *= parseFloat(cs(n).opacity || '1');
  return o;
}
RL.effectiveOpacity = effectiveOpacity;

// ---------------------------------------------------------------------------
// Ignore directives
//   data-renderlint-ignore            -> ignore every rule for this subtree
//   data-renderlint-ignore="a b,c"    -> ignore listed rules for this subtree
//   CSS: --renderlint-ignore: a b;    -> same, inherited through the cascade
// ---------------------------------------------------------------------------

const ignoreCache = new Map();
function ignoreSet(el) {
  if (!el || el.nodeType !== 1) return null;
  if (ignoreCache.has(el)) return ignoreCache.get(el);
  let set = null;
  const add = (str) => {
    set = set || new Set();
    const parts = String(str).split(/[\s,]+/).filter(Boolean);
    if (!parts.length || parts.includes('all') || parts.includes('*')) set.add('*');
    parts.forEach((p) => set.add(p));
  };
  for (let n = el; n; n = parentOf(n)) {
    if (n.hasAttribute && n.hasAttribute('data-renderlint-ignore')) add(n.getAttribute('data-renderlint-ignore'));
  }
  const css = cs(el).getPropertyValue('--renderlint-ignore');
  if (css && css.trim()) add(css.trim().replace(/^["']|["']$/g, ''));
  ignoreCache.set(el, set);
  return set;
}
RL.isIgnored = function (el, rule) {
  if (!el) return false;
  const target = el.nodeType === 1 ? el : el.parentElement;
  const set = ignoreSet(target);
  if (set && (set.has('*') || set.has(rule))) return true;
  for (const sel of RL.options.ignoreSelectors[rule] || []) {
    try { if (target.closest(sel)) return true; } catch (e) { /* bad selector */ }
  }
  for (const sel of RL.options.ignoreSelectors['*'] || []) {
    try { if (target.closest(sel)) return true; } catch (e) { /* bad selector */ }
  }
  return false;
};

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const colorCanvas = document.createElement('canvas');
colorCanvas.width = colorCanvas.height = 1;
const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
const colorCache = new Map();

// Parses any CSS color (rgb, hex, oklch, lab, color-mix results...) to sRGB 0-255 + alpha.
function parseColor(str) {
  if (!str) return null;
  if (colorCache.has(str)) return colorCache.get(str);
  let out = null;
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
  if (m) {
    let a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    out = { r: +m[1], g: +m[2], b: +m[3], a };
  } else if (str === 'transparent') {
    out = { r: 0, g: 0, b: 0, a: 0 };
  } else {
    // Let the browser convert it. Alpha is read separately for precision.
    let alpha = 1;
    const am = /\/\s*([\d.]+%?)\s*\)$/.exec(str);
    if (am) alpha = am[1].endsWith('%') ? parseFloat(am[1]) / 100 : parseFloat(am[1]);
    colorCtx.clearRect(0, 0, 1, 1);
    colorCtx.globalCompositeOperation = 'copy';
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = str.replace(/\/\s*[\d.]+%?\s*\)$/, ')');
    colorCtx.fillRect(0, 0, 1, 1);
    const d = colorCtx.getImageData(0, 0, 1, 1).data;
    out = { r: d[0], g: d[1], b: d[2], a: alpha * (d[3] / 255) };
  }
  colorCache.set(str, out);
  return out;
}
RL.parseColor = parseColor;

function luminance(c) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
RL.luminance = luminance;
RL.contrast = function (a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
RL.blend = function (fg, bg) {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
};
RL.hex = function (c) {
  const h = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + h(c.r) + h(c.g) + h(c.b);
};

// Approximate background behind an element by compositing ancestor backgrounds.
// Returns null when the background is not a flat color (images, gradients).
RL.backgroundOf = function (el) {
  const layers = [];
  for (let n = el; n; n = parentOf(n)) {
    const s = cs(n);
    if (s.backgroundImage && s.backgroundImage !== 'none') return null;
    const c = parseColor(s.backgroundColor);
    if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
  }
  let base = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) base = RL.blend(layers[i], base);
  return base;
};

// ---------------------------------------------------------------------------
// Emoji detection: characters that render with emoji presentation.
// ---------------------------------------------------------------------------
RL.EMOJI_RE = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}️|[\u{1F1E6}-\u{1F1FF}]{2})/gu;

// ---------------------------------------------------------------------------
// Element description for reports
// ---------------------------------------------------------------------------

function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^\w-]/g, '\\$&'); }

function stepSelector(el) {
  const tag = el.tagName.toLowerCase();
  if (el.id && !/^\d|:|[0-9a-f]{6,}|radix|headlessui|react-aria|«|:r/.test(el.id)) {
    try { if (document.querySelectorAll('#' + cssEscape(el.id)).length === 1) return { sel: '#' + cssEscape(el.id), unique: true }; } catch (e) { /* ignore */ }
  }
  let sel = tag;
  const classes = (typeof el.className === 'string' ? el.className : (el.getAttribute('class') || ''))
    .split(/\s+/).filter((c) => c && !/[:[\]/!@()%.#]/.test(c) && c.length < 40 && !/^(css|sc|jsx|svelte|emotion|chakra)-[a-z0-9]+$/i.test(c));
  if (classes.length) sel += '.' + classes.slice(0, 2).map(cssEscape).join('.');
  const p = el.parentElement;
  if (p) {
    const same = Array.from(p.children).filter((c) => c.tagName === el.tagName);
    if (same.length > 1) sel += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
  }
  return { sel, unique: false };
}

RL.selector = function (el) {
  if (!el || el.nodeType !== 1) return '';
  const parts = [];
  for (let n = el, depth = 0; n && n.nodeType === 1 && depth < 6; n = n.parentElement, depth++) {
    if (n === document.body || n === document.documentElement) break;
    const st = stepSelector(n);
    parts.unshift(st.sel);
    if (st.unique) break;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
};

RL.snippet = function (el, max) {
  max = max || 70;
  const t = (el.nodeType === 3 ? el.textContent : (el.innerText || el.textContent || '')).replace(/\s+/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
};

// Best-effort mapping from a DOM node back to the component / source file.
RL.sourceOf = function (el) {
  const out = {};
  for (let n = el, depth = 0; n && depth < 25; n = parentOf(n), depth++) {
    if (n.nodeType !== 1) continue;
    // Astro dev
    if (!out.file && n.hasAttribute('data-astro-source-file')) {
      out.file = n.getAttribute('data-astro-source-file');
      const loc = n.getAttribute('data-astro-source-loc');
      if (loc) out.line = parseInt(loc, 10);
    }
    // Generic attribute (e.g. from a babel/jsx-source plugin)
    if (!out.file && n.hasAttribute('data-source')) {
      const m = /^(.*?):(\d+)/.exec(n.getAttribute('data-source'));
      if (m) { out.file = m[1]; out.line = +m[2]; }
    }
    // Svelte dev
    if (!out.file && n.__svelte_meta && n.__svelte_meta.loc) {
      out.file = n.__svelte_meta.loc.file; out.line = n.__svelte_meta.loc.line;
    }
    // Vue 3 dev
    if (n.__vueParentComponent && !out.component) {
      const t = n.__vueParentComponent.type || {};
      out.component = t.__name || t.name || (t.__file ? t.__file.split('/').pop() : undefined);
      if (!out.file && t.__file) out.file = t.__file;
    }
    // React (16-19)
    if (!out.component) {
      const key = Object.keys(n).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      if (key) {
        let f = n[key];
        if (!out.file && f && f._debugSource) { out.file = f._debugSource.fileName; out.line = f._debugSource.lineNumber; }
        if (!out.file && f && f._debugStack && f._debugStack.stack) {
          const fr = f._debugStack.stack.split('\n').slice(1).find((l) => !/node_modules|react-dom|react\.|jsx-dev-runtime|chunk-/.test(l) && /:\d+:\d+/.test(l));
          if (fr) {
            const m = /(?:\(|at |@)?((?:https?:\/\/[^/]+)?\/[^\s()]+?):(\d+):\d+\)?\s*$/.exec(fr);
            if (m) { out.file = m[1].replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, ''); out.line = +m[2]; }
          }
        }
        for (let g = f, i = 0; g && i < 60; g = g.return, i++) {
          if (typeof g.type === 'function' || (g.type && typeof g.type === 'object' && (g.type.render || g.type.type))) {
            const t = typeof g.type === 'function' ? g.type : (g.type.render || g.type.type);
            const name = (g.type.displayName || t.displayName || t.name);
            if (name && !/^(Fragment|Suspense|StrictMode|Provider|Consumer|ErrorBoundary|Router|Link|Slot|Primitive|Presence)$/.test(name) && name.length > 1) {
              out.component = name;
              if (!out.file && g._debugSource) { out.file = g._debugSource.fileName; out.line = g._debugSource.lineNumber; }
              break;
            }
          }
        }
      }
    }
    if (out.component && out.file) break;
  }
  return out.component || out.file ? out : undefined;
};

RL.describe = function (el) {
  const r = el.getBoundingClientRect ? docRect(el.getBoundingClientRect()) : null;
  return {
    selector: RL.selector(el),
    text: RL.snippet(el),
    rect: r && { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) },
    source: RL.sourceOf(el),
  };
};

// ---------------------------------------------------------------------------
// Collection of text runs and candidate elements (shared by rules)
// ---------------------------------------------------------------------------

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT', 'OPTION', 'DATALIST']);

RL.allElements = function () {
  const out = [];
  const walk = (root) => {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => SKIP_TAGS.has(n.tagName) || n.id === '__renderlint_overlay' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = it.currentNode; n; n = it.nextNode()) {
      if (n.nodeType === 1) { out.push(n); if (n.shadowRoot) walk(n.shadowRoot); }
    }
  };
  walk(document.body);
  return out;
};

RL.collectText = function () {
  const items = [];
  const range = document.createRange();
  const visit = (root) => {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => {
        if (n.nodeType === 1) return SKIP_TAGS.has(n.tagName) || n.id === '__renderlint_overlay' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
        return /\S/.test(n.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    let n;
    while ((n = it.nextNode())) {
      const el = n.parentElement || (n.parentNode && n.parentNode.host);
      if (!el || !isVisible(el)) continue;
      range.selectNodeContents(n);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5).map(docRect);
      if (!rects.length) continue;
      const clip = RL.clipBoxOf(el);
      const vis = clip ? rects.map((r) => intersect(r, clip)).filter(Boolean) : rects;
      if (!vis.length || vis.every((r) => r.w < 1 || r.h < 1)) continue; // fully clipped away (carousel slide, collapsed panel)
      items.push({ node: n, el, rects, vis, box: unionRects(rects), text: n.textContent.replace(/\s+/g, ' ').trim() });
    }
    // shadow roots
    root.querySelectorAll && root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) visit(e.shadowRoot); });
  };
  visit(document.body);
  return items;
};

// Region an element's *content* can paint into: the intersection of its own
// overflow clip and every ancestor's. null = unclipped.
const clipCache = new Map();
RL.clipBoxOf = function (el) {
  if (!el || el === document.documentElement || el === document.body) return null;
  if (clipCache.has(el)) return clipCache.get(el);
  const s = cs(el);
  let box = s.position === 'fixed' ? null : RL.clipBoxOf(parentOf(el));
  const isSvg = el.namespaceURI === 'http://www.w3.org/2000/svg';
  if ((!isSvg || el.tagName.toLowerCase() === 'svg') && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
    const r = docRect(el.getBoundingClientRect());
    const own = {
      x: s.overflowX !== 'visible' ? r.x : -1e9, right: s.overflowX !== 'visible' ? r.right : 1e9,
      y: s.overflowY !== 'visible' ? r.y : -1e9, bottom: s.overflowY !== 'visible' ? r.bottom : 1e9,
    };
    own.w = own.right - own.x; own.h = own.bottom - own.y;
    box = box ? (intersect(box, own) || { x: 0, y: 0, w: 0, h: 0, right: 0, bottom: 0 }) : own;
  }
  clipCache.set(el, box);
  return box;
};

RL.isInteractive = function (el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'select' || tag === 'textarea' || tag === 'summary') return true;
  if (tag === 'a' && el.hasAttribute('href')) return true;
  if (tag === 'input' && el.type !== 'hidden') return true;
  const role = el.getAttribute('role');
  if (role && /^(button|link|checkbox|radio|switch|tab|menuitem|option|slider|combobox)$/.test(role)) return true;
  return false;
};

RL.isDisabled = function (el) {
  for (let n = el; n; n = parentOf(n)) {
    if (n.nodeType === 1 && (n.disabled || n.getAttribute('aria-disabled') === 'true')) return true;
    if (n.tagName === 'FIELDSET' && n.disabled) return true;
  }
  return false;
};

// Stack of elements at a document point. Scrolls the window if the point is
// outside the viewport (elementsFromPoint only works for visible points).
RL.stackAt = function (x, y) {
  const vy = y - scrollY, vx = x - scrollX;
  if (vy < 0 || vy >= innerHeight || vx < 0 || vx >= innerWidth) {
    window.scrollTo({ left: Math.max(0, x - innerWidth / 2), top: Math.max(0, y - innerHeight / 2), behavior: 'instant' });
  }
  return { stack: document.elementsFromPoint(x - scrollX, y - scrollY), scrolled: scrollY !== 0 || scrollX !== 0 };
};

// Colors inside a gradient: every stop must be (mostly) opaque for the layer to hide what is beneath.
const COLOR_TOKEN = /(?:rgba?|hsla?|oklch|oklab|lab|lch|color|hwb)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi;
function gradientOpaque(img) {
  if (/url\(/.test(img)) return true;
  const stops = img.match(COLOR_TOKEN) || [];
  if (!stops.length) return false;
  return stops.every((c) => { const p = parseColor(c); return p && p.a >= 0.6; });
}

RL.isOpaqueLayer = function (el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture') return effectiveOpacity(el) > 0.5;
  const s = cs(el);
  const bg = parseColor(s.backgroundColor);
  const glass = s.backdropFilter && s.backdropFilter !== 'none' && bg && bg.a > 0.1;
  if ((bg && bg.a >= 0.5) || glass || (s.backgroundImage && s.backgroundImage !== 'none' && gradientOpaque(s.backgroundImage))) {
    return effectiveOpacity(el) > 0.5;
  }
  return false;
};

// Element sits in a deliberately layered composition (absolute/transform/offset)
// between itself and `stop` (exclusive).
RL.layeredBetween = function (el, stop) {
  for (let n = el; n && n !== stop; n = parentOf(n)) {
    const s = cs(n);
    if (s.position === 'absolute' || s.position === 'fixed') return true;
    if (s.transform !== 'none' || (s.translate && s.translate !== 'none') || (s.rotate && s.rotate !== 'none') || (s.scale && s.scale !== 'none')) return true;
    if (s.position === 'relative' && ((parseFloat(s.top) || 0) !== 0 || (parseFloat(s.left) || 0) !== 0)) return true;
  }
  return false;
};

RL.commonAncestor = function (a, b) {
  const set = new Set();
  for (let n = a; n; n = parentOf(n)) set.add(n);
  for (let n = b; n; n = parentOf(n)) if (set.has(n)) return n;
  return null;
};

RL.fixedAncestor = function (el) {
  for (let n = el; n; n = parentOf(n)) {
    const p = cs(n).position;
    if (p === 'fixed' || p === 'sticky') return n;
  }
  return null;
};
