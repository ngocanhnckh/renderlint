// In-page orchestrator. Exposed as window.__renderlint.

RL.options = { ignoreSelectors: {} };

RL.issueBase = function (el, related) {
  const d = RL.describe(el);
  const out = { selector: d.selector, text: d.text, rect: d.rect, source: d.source };
  if (related) {
    const r = RL.describe(related);
    out.related = { selector: r.selector, text: r.text, rect: r.rect, source: r.source };
  }
  return out;
};

RL.analyze = function (options) {
  options = options || {};
  RL.options = {
    ignoreSelectors: options.ignoreSelectors || {},
    minTapTarget: options.minTapTarget,
    minFontSize: options.minFontSize,
    maxLineLength: options.maxLineLength,
    noScroll: !!options.noScroll,
  };
  const enabled = (id) => !options.rules || options.rules[id] === undefined || options.rules[id] !== 'off';
  RL.resetCaches();
  RL.flagged = new Set();
  const t0 = performance.now();
  const startX = scrollX, startY = scrollY;
  const scrollTop = () => { if (!options.noScroll) window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); };
  scrollTop();

  const ctx = {
    texts: RL.collectText(),
    elements: RL.allElements().filter(RL.inScope()),
    issues: [],
    errors: [],
    report(issue) {
      const { el, related, ...rest } = issue;
      if (options.alsoIgnore && el && (RL.isIgnored(el, options.alsoIgnore) || (related && RL.isIgnored(related, options.alsoIgnore)))) return;
      if (el && el.nodeType === 1 && /^(text-overflow|text-clipped|obscured-content|viewport-overflow)$/.test(issue.rule)) RL.flagged.add(el);
      this.issues.push({ ...rest, ...RL.issueBase(el, related) });
    },
  };
  const rules = RL.rules.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  const timings = {};
  let peStyle = null;
  for (const rule of rules) {
    if (!enabled(rule.id)) continue;
    if (rule.order >= 90 && !peStyle) {
      // Hit-test decorative layers too (pointer-events:none still paints over content).
      peStyle = document.createElement('style');
      peStyle.id = '__renderlint_pe';
      peStyle.textContent = '*{pointer-events:auto!important}';
      document.head.appendChild(peStyle);
    }
    if (rule.domOnly && options.skipDomContrast) continue;
    const s = performance.now();
    try { rule.run(ctx); } catch (e) { ctx.errors.push(rule.id + ': ' + (e && e.stack || e)); }
    timings[rule.id] = Math.round(performance.now() - s);
    if (rule.order >= 90) scrollTop();
  }
  scrollTop();
  if (peStyle) peStyle.remove();

  const contrast = options.contrastCandidates ? RL.collectContrast() : undefined;
  const de = document.documentElement;
  const meta = {
    title: document.title,
    width: de.clientWidth,
    height: Math.max(de.scrollHeight, document.body ? document.body.scrollHeight : 0),
    texts: ctx.texts.length,
    elements: ctx.elements.length,
    ms: Math.round(performance.now() - t0),
    timings,
    darkModeCss: RL.hasDarkModeCss(),
    links: Array.from(document.querySelectorAll('a[href]')).map((a) => a.href).filter((h) => /^https?:/.test(h)).slice(0, 500),
    suppressed: document.querySelectorAll('[data-renderlint-ignore]').length,
    platform: RL.platform(),
  };
  if (options.restoreScroll && !options.noScroll) window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
  return { issues: ctx.issues, errors: ctx.errors, contrast, meta };
};

// Contrast candidates, collected fresh (call after animations settled again,
// since the occlusion rules scroll the page and may trigger reveal animations).
RL.collectContrast = function (solid) {
  RL.resetCaches();
  const cands = RL.contrastCandidates(RL.collectText());
  window.__renderlint_cx = cands.map((c) => c.el);
  if (solid) RL.solidBackgrounds(cands); // text on a provably flat colour needs no capture
  return cands.map((c) => ({
    idx: c.idx, rects: c.rects, color: c.color, opacity: c.opacity, fontSize: c.fontSize, fontWeight: c.fontWeight,
    large: c.large, complex: c.complex, placeholder: c.placeholder, bg: c.bg, why: c.why, base: RL.issueBase(c.el),
  }));
};

RL.finishAnimations = function () {
  for (const a of document.getAnimations ? document.getAnimations() : []) {
    try {
      const end = a.effect && a.effect.getComputedTiming().endTime;
      if (end !== undefined && isFinite(end)) a.finish(); else a.pause();
    } catch (e) { /* ignore */ }
  }
};

RL.hasDarkModeCss = function () {
  const check = (rules, depth) => {
    if (!rules || depth > 4) return false;
    for (const r of rules) {
      if (r.media && /prefers-color-scheme:\s*dark/.test(r.media.mediaText)) return true;
      if (r.cssRules && check(r.cssRules, depth + 1)) return true;
    }
    return false;
  };
  for (const sheet of document.styleSheets) {
    try { if (check(sheet.cssRules, 0)) return true; } catch (e) { /* cross-origin */ }
  }
  const scheme = document.querySelector('meta[name="color-scheme"]');
  return !!(scheme && /dark/.test(scheme.content));
};

// Can the layout rules give different results in another color scheme? The runner
// re-runs the stress passes in dark mode only when they can. Two parts:
//   paintOnly  every CSS declaration that depends on prefers-color-scheme sets a
//              property that never changes layout (colors, backgrounds, shadows,
//              outlines), or a custom property only used by such properties. So any
//              DOM, including stressed text and reloaded data, lays out the same.
//   sig        a hash of what the layout rules read that CSS could still change or
//              that JS could swap per scheme: the DOM (structure, attributes, text),
//              the CSSOM, every element's box, and the alpha / presence of its
//              colors, backgrounds and shadows (rules test "has a visible boundary",
//              "is opaque", never the hue; shadows only for presence). Equal signatures + paintOnly ⇒ identical
//              layout findings.
const PAINT_PROP = /^(color|background(-color|-image|-position(-x|-y)?|-size|-repeat|-attachment|-origin|-clip|-blend-mode)?|border(-(top|right|bottom|left|block|inline|block-start|block-end|inline-start|inline-end))?-color|outline(-color|-style|-width|-offset)?|text-decoration(-color|-line|-style|-thickness)?|text-underline-offset|text-emphasis-color|caret-color|accent-color|column-rule-color|fill|stroke|stop-color|flood-color|lighting-color|color-scheme|box-shadow|text-shadow|-webkit-text-fill-color|-webkit-text-stroke-color|-webkit-tap-highlight-color|scrollbar-color|forced-color-adjust|print-color-adjust|-webkit-print-color-adjust|transition(-[a-z-]+)?)$/;
const SCHEME_MQ = /prefers-color-scheme/i;
const ALPHA_PROPS = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'webkitTextFillColor', 'fill'];
const isColor = (v) => !/var\(/.test(v) && CSS.supports('color', v);
// Is position i of a declaration value inside rgb(…), hsl(…), color-mix(…) etc.?
function inColorFunction(value, i) {
  let depth = 0;
  for (let k = i - 1; k >= 0; k--) {
    if (value[k] === ')') depth++;
    else if (value[k] === '(') {
      if (depth) { depth--; continue; }
      if (/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)$/i.test(value.slice(Math.max(0, k - 10), k))) return true;
    }
  }
  return false;
}
const colorAlpha = (c) => { const p = RL.parseColor(c); return p ? Math.round(p.a * 100) : c; };
const colorTokensToAlpha = (v) => v.replace(/(?:rgba?|hsla?|oklch|oklab|lab|lch|color|hwb)\([^()]*\)|#[0-9a-f]{3,8}\b|\btransparent\b/gi, (c) => 'a' + colorAlpha(c)).replace(/url\([^)]*\)/g, 'url');

function cyrb53(str, seed) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

// Top-level declarations of a style block, shorthands kept as written (var() in shorthands).
function declarations(style) {
  const out = [];
  for (const part of (style.cssText || '').split(/;(?![^(]*\))/)) {
    const i = part.indexOf(':');
    if (i > 0) out.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]);
  }
  return out;
}

RL.schemeSignature = function (debug) {
  const crossOrigin = [];
  let paintOnly = true;
  const schemeCustom = new Set(); // custom properties set under a color-scheme condition
  const layoutVars = new Set(); // custom properties a layout property may substitute (outside a color function)
  const varEdges = []; // [custom prop, var its value substitutes outside a color function]
  const values = new Map(); // custom property → every value declared for it
  const cssText = [];
  const visitDecls = (style, conditioned) => {
    for (const [prop, value] of declarations(style)) {
      const custom = prop.startsWith('--');
      if (conditioned) {
        if (custom) schemeCustom.add(prop);
        else if (!PAINT_PROP.test(prop)) paintOnly = false;
      }
      if (custom) { if (!values.has(prop)) values.set(prop, []); values.get(prop).push(value); }
      for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (inColorFunction(value, m.index)) continue; // hsl(var(--border)): a color whatever the value
        if (custom) varEdges.push([prop, m[1]]);
        else if (!PAINT_PROP.test(prop)) layoutVars.add(m[1]);
      }
    }
  };
  const visitRules = (rules, conditioned, depth) => {
    if (!rules || depth > 12) return;
    for (const r of rules) {
      const cond = conditioned || (r.media && SCHEME_MQ.test(r.media.mediaText)) || (r.conditionText && SCHEME_MQ.test(r.conditionText));
      if (r.style) visitDecls(r.style, cond);
      if (r.styleSheet) visitSheet(r.styleSheet, cond); // @import
      if (r.cssRules) visitRules(r.cssRules, cond, depth + 1);
    }
  };
  const visitSheet = (sheet, conditioned) => {
    const cond = conditioned || (sheet.media && SCHEME_MQ.test(sheet.media.mediaText));
    let rules;
    try { rules = sheet.cssRules; } catch (e) { crossOrigin.push({ href: sheet.href, conditioned: !!cond }); return; }
    if (sheet.ownerNode && sheet.ownerNode.id === '__renderlint_pe') return;
    visitRules(rules, cond, 0);
    for (const r of rules) cssText.push(r.cssText);
  };
  const roots = [document];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  for (const root of roots) {
    for (const s of root.styleSheets) visitSheet(s, false);
    for (const s of root.adoptedStyleSheets || []) visitSheet(s, false);
  }
  for (const el of document.querySelectorAll('[style]')) visitDecls(el.style, false);
  // A custom property is layout-relevant if a layout property uses it, directly or through other custom properties.
  for (let changed = true; changed;) {
    changed = false;
    for (const [p, v] of varEdges) if (layoutVars.has(p) && !layoutVars.has(v)) { layoutVars.add(v); changed = true; }
  }
  // `border: 1px solid var(--line)` is fine when --line is a color in every declaration.
  const isColorVar = (p, seen) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return (values.get(p) || []).every((v) => {
      const ref = /^var\(\s*(--[\w-]+)\s*(?:,(.*))?\)$/.exec(v.replace(/\s*!important$/, ''));
      if (ref) return isColorVar(ref[1], seen) && (ref[2] === undefined || isColor(ref[2].trim()));
      return isColor(v.replace(/\s*!important$/, ''));
    });
  };
  for (const p of schemeCustom) if (layoutVars.has(p) && !isColorVar(p, new Set())) paintOnly = false;

  window.scrollTo({ left: 0, top: 0, behavior: 'instant' }); // the stress passes start from the top too
  const parts = [cyrb53(cssText.join('\n'), 1), innerWidth, innerHeight, document.documentElement.scrollWidth, document.documentElement.scrollHeight];
  const walk = (root) => {
    const it = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) {
      if (n.nodeType === 3) { parts.push('"' + n.data); continue; }
      if (n.id === '__renderlint_overlay' || n.id === '__renderlint_pe') continue;
      let line = '<' + n.tagName;
      for (const a of n.attributes) line += ' ' + a.name + '=' + a.value;
      if (n.value !== undefined && /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName)) line += ' value=' + n.value;
      const r = n.getBoundingClientRect();
      line += ' @' + Math.round(r.x * 64) + ',' + Math.round(r.y * 64) + ',' + Math.round(r.width * 64) + ',' + Math.round(r.height * 64);
      const s = getComputedStyle(n);
      for (const p of ALPHA_PROPS) line += ' ' + colorAlpha(s[p]);
      line += ' ' + colorTokensToAlpha(s.backgroundImage) + ' ' + (s.boxShadow === 'none' ? 'none' : /^rgba\(0, 0, 0, 0\)/.test(s.boxShadow) ? 'T' : 'V') + ' ' + s.backgroundClip + ' ' + s.webkitBackgroundClip;
      parts.push(line);
      if (n.shadowRoot) walk(n.shadowRoot);
    }
  };
  walk(document.documentElement);
  return {  sig: cyrb53(parts.join('\n'), 7), paintOnly, crossOrigin, ...(debug ? { parts, schemeCustom: [...schemeCustom], layoutVars: [...layoutVars] } : {}) };
};

// Viewport widths where the page's layout switches: from width media queries in
// the CSS (also inside @import/<link media>, nested and @supports rules) and from
// matchMedia() calls the page made (recorded by the runner's init script). Each
// entry is the first width of the wider side: (min-width: 768px) → 768,
// (max-width: 767.98px) → 768, (width > 40rem) → 641. Container queries depend on
// container sizes, not the viewport, and are not included.
const BP_FEATURE = /\((min|max)-width\s*:\s*([\d.]+)(px|r?em)\s*\)|\(([^()]*?\bwidth\b[^()]*?)\)/gi;
RL.breakpoints = function () {
  const out = new Set();
  const px = (n, unit) => +n * (unit === 'px' ? 1 : 16); // em/rem in media queries: the initial font size
  const add = (x, inclusive, upper) => {
    // inclusive lower bound (min-width, >=) starts at ceil(x); exclusive (>) and max-width (≤ x) switch at floor(x)+1
    const u = upper ? (inclusive ? Math.floor(x) + 1 : Math.ceil(x)) : (inclusive ? Math.ceil(x) : Math.floor(x) + 1);
    if (u > 0 && u < 10000) out.add(u);
  };
  const parse = (text) => {
    for (const m of String(text).matchAll(BP_FEATURE)) {
      if (m[1]) { add(px(m[2], m[3]), true, m[1].toLowerCase() === 'max'); continue; }
      // range syntax: (width >= 40rem), (640px < width <= 1024px)
      for (const r of m[4].matchAll(/([\d.]+)(px|r?em)\s*(<=|>=|<|>)\s*width|width\s*(<=|>=|<|>)\s*([\d.]+)(px|r?em)/gi)) {
        if (r[1]) { const op = r[3]; add(px(r[1], r[2]), op.length === 2, op[0] === '>'); } // 640px < width: lower bound; 1024px >= width: upper
        else { const op = r[4]; add(px(r[5], r[6]), op.length === 2, op[0] === '<'); }
      }
    }
  };
  const visitRules = (rules, depth) => {
    if (!rules || depth > 12) return;
    for (const r of rules) {
      if (r.media) parse(r.media.mediaText); // @media, @import … screen and (…)
      if (r.styleSheet) visitSheet(r.styleSheet);
      if (r.cssRules) visitRules(r.cssRules, depth + 1);
    }
  };
  const visitSheet = (sheet) => {
    if (sheet.media) parse(sheet.media.mediaText);
    let rules;
    try { rules = sheet.cssRules; } catch (e) { return; }
    visitRules(rules, 0);
  };
  const roots = [document];
  for (const el of document.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  for (const root of roots) {
    for (const s of root.styleSheets) visitSheet(s);
    for (const s of root.adoptedStyleSheets || []) visitSheet(s);
  }
  for (const el of document.querySelectorAll('source[media],link[media]')) parse(el.getAttribute('media'));
  for (const q of window.__renderlint_mq || []) parse(q);
  return Array.from(out).sort((a, b) => a - b);
};

// Stress profiles: rewrite visible text to simulate content the sample data
// doesn't have, so layouts that only fit the current copy are caught.
//   longer      every text run gets ~factor× as many words (still wrappable)
//   long-words  emails, URLs, domains and IDs become 36+ character unbreakable tokens
//   big-numbers numbers (KPIs, counters, prices) get three more digits
//   declared    elements with data-renderlint-sample / data-renderlint-maxlength
//               get the worst case the developer declared
// RL.unstress() restores the original text.
const DATA_TOKEN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+|https?:\/\/[^\s]+|www\.[^\s]+|\b[\w-]+\.(?:com|net|org|io|app|dev|co|ai|de|fr|uk|vn|jp|cn|ru|br|in|us|info|biz|eu|me|tech|cloud|so|sh|xyz)\b|\b(?=[A-Za-z-]*\d)(?=[\d-]*[A-Za-z])[A-Za-z\d-]{6,}\b/;
const FILLER = 'internationalizationprocurementdepartment';
RL.stressSaved = [];

function stressNodes() {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION|CODE|PRE)$/.test(p.tagName) || p.closest('svg') || RL.isDevTool(p)) continue;
    out.push(n);
  }
  return out;
}

function declaredHost(n) {
  const p = n.parentElement;
  return p && p.closest('[data-renderlint-sample],[data-renderlint-maxlength]');
}

function setText(n, text) {
  RL.stressSaved.push([n, n.textContent]);
  n.textContent = text;
}

function fillTo(text, len) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  let out = text.trim();
  for (let i = 0; out.length < len; i++) out += ' ' + words[i % words.length];
  return out.slice(0, len);
}

function longToken(tok) {
  if (tok.length >= 36) return tok;
  const at = tok.indexOf('@');
  const cut = at > 0 ? at : Math.ceil(tok.length / 2);
  return tok.slice(0, cut) + FILLER.slice(0, 36 - tok.length) + tok.slice(cut);
}

RL.stress = function (profile, factor) {
  RL.unstress();
  let count = 0;
  if (profile === 'declared') {
    for (const host of document.querySelectorAll('[data-renderlint-sample],[data-renderlint-maxlength]')) {
      if (RL.isDevTool(host)) continue;
      const texts = [];
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) texts.push(n);
      if (!texts.length) continue;
      const sample = host.getAttribute('data-renderlint-sample');
      const max = parseInt(host.getAttribute('data-renderlint-maxlength'), 10);
      const full = texts.map((t) => t.data).join('').trim();
      const target = sample != null ? sample : max > 0 ? fillTo(full, max) : null;
      if (target == null) continue;
      setText(texts[0], target);
      for (const t of texts.slice(1)) setText(t, '');
      count++;
    }
    return count;
  }
  for (const n of stressNodes()) {
    if (declaredHost(n)) continue;
    const txt = n.textContent.trim();
    if (profile === 'big-numbers') {
      // KPI values and counters grow: 288 → 288,000, $4939.27 → $4,939,000.27. Dates and times stay.
      const digits = (txt.match(/\d/g) || []).length, letters = (txt.match(/\p{L}/gu) || []).length;
      if (!digits || digits < letters || txt.length > 40 || /\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(txt)) continue;
      setText(n, n.textContent.replace(/\d[\d,]*(?:\.\d+)?/g, (tok) => {
        const [int, dec] = tok.replace(/,/g, '').split('.');
        const grown = String(Math.max(1000, (+int) * 1000)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return grown + (dec !== undefined ? '.' + dec : '');
      }));
      count++;
    } else if (profile === 'long-words') {
      const m = DATA_TOKEN.exec(txt);
      if (!m) continue;
      setText(n, n.textContent.replace(m[0], longToken(m[0])));
      count++;
    } else {
      if (txt.length <= 3 || !/\p{L}{2}/u.test(txt)) continue; // initials, numbers, icons don't grow with real data
      const words = txt.split(/\s+/);
      const extra = Math.max(1, Math.round(words.length * ((factor || 1.5) - 1)));
      const add = [];
      for (let i = 0; i < extra; i++) add.push(words[i % words.length]);
      setText(n, n.textContent.replace(/\s*$/, '') + ' ' + add.join(' ') + (/\s$/.test(n.textContent) ? ' ' : ''));
      count++;
    }
  }
  return count;
};

RL.unstress = function () {
  for (let i = RL.stressSaved.length - 1; i >= 0; i--) {
    const [n, text] = RL.stressSaved[i];
    n.textContent = text;
  }
  RL.stressSaved = [];
};
