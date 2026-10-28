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
    elements: RL.allElements(),
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
