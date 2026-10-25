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
  };
  if (options.restoreScroll && !options.noScroll) window.scrollTo({ left: startX, top: startY, behavior: 'instant' });
  return { issues: ctx.issues, errors: ctx.errors, contrast, meta };
};

// Contrast candidates, collected fresh (call after animations settled again,
// since the occlusion rules scroll the page and may trigger reveal animations).
RL.collectContrast = function () {
  RL.resetCaches();
  const cands = RL.contrastCandidates(RL.collectText());
  window.__renderlint_cx = cands.map((c) => c.el);
  return cands.map((c) => ({
    idx: c.idx, rects: c.rects, color: c.color, opacity: c.opacity, fontSize: c.fontSize, fontWeight: c.fontWeight,
    large: c.large, complex: c.complex, placeholder: c.placeholder, base: RL.issueBase(c.el),
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
