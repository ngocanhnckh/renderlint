// In-page instrumentation for the loading-state experiment (installed with addInitScript).
// window.__lb.snap() -> what the user sees now: text, media, placeholder blocks, loading signals.
(() => {
  if (window.__lb) return;
  const lb = (window.__lb = { muts: [], longtasks: [] });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) lb.longtasks.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); })
      .observe({ type: 'longtask', buffered: true });
  } catch (e) { /* ignore */ }
  const startMO = () => new MutationObserver((recs) => {
    const t = performance.now();
    for (const r of recs) if (lb.muts.length < 20000) lb.muts.push({ t, k: r.type[0], a: r.attributeName || '' });
  }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  if (document.documentElement) startMO(); else document.addEventListener('DOMContentLoaded', startMO);

  const LOADING_RE = /\b(loading|fetching|please wait|saving|submitting|processing|updating|refreshing|syncing|signing in)\b/i;
  const NAME_RE = /skelet|spinner|\bspin\b|loader|loading|shimmer|placeholder|progress|pulse|busy/i;
  const shown = (el) => el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : !!el.offsetParent;
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const R = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  const selOf = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  const bgOf = (s) => s.backgroundImage !== 'none' || (s.backgroundColor && !/rgba\(.*, 0\)|transparent/.test(s.backgroundColor));

  // snap('mark') remembers every element present; snap('group') tags each item with the
  // nearest ancestor that was present at the marked snap: the container content went into
  let seen = new WeakSet(); const gid = new Map(); let s1Text = [], b1 = [];
  const anc = (el) => { const out = []; for (let a = el; a; a = a.parentElement) out.push(a); return out; };
  const pathFrom = (chain, a) => { const i = chain.indexOf(a); return i < 0 ? null : chain.slice(0, i).reverse().map((e) => e.tagName.toLowerCase()).join('>'); };
  const groupOf = (el) => {
    let a = el; while (a && !seen.has(a)) a = a.parentElement;
    if (!a) return -1;
    if (!gid.has(a)) gid.set(a, { id: gid.size, s: selOf(a), prior: [...new Set(s1Text.map((c) => pathFrom(c, a)).filter((x) => x !== null))] });
    return gid.get(a).id;
  };
  const pathOf = (el) => { let a = el; while (a && !seen.has(a)) a = a.parentElement; return a ? pathFrom(anc(el), a) : ''; };
  lb.snap = (mode) => {
    if (mode === 'mark') { seen = new WeakSet(); gid.clear(); s1Text = []; b1 = []; for (const el of document.querySelectorAll('*')) seen.add(el); }
    const G = mode === 'group' ? groupOf : () => undefined;
    const texts = [], hidden = [], media = [], blocks = [], ind = [];
    const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName) || !shown(el)) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (r.width * r.height < 16) { hidden.push(t); continue; } // visually hidden (sr-only)
      if (!inView(r)) continue;
      texts.push({ t: t.slice(0, 80), r: R(r), g: G(el), p: mode === 'group' ? pathOf(el) : undefined });
      if (mode === 'mark') s1Text.push(anc(el));
    }
    for (const el of document.querySelectorAll('img,svg,canvas,video,picture,iframe')) {
      if (el.tagName === 'svg' && el.parentElement && el.parentElement.closest('svg')) continue;
      if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height >= 64 && inView(r) && shown(el)) media.push({ t: el.tagName + ':' + (el.getAttribute('src') || '').slice(-40), r: R(r), g: G(el) });
    }
    const all = document.body ? document.body.querySelectorAll('*') : [];
    const vpArea = innerWidth * innerHeight;
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (!inView(r)) continue;
      const area = r.width * r.height;
      const s = getComputedStyle(el);
      // placeholder blocks: boxes without text that paint something (a static skeleton)
      if (area >= 60 && area < vpArea * 0.25 && !el.textContent.trim() && !el.querySelector('img,svg,canvas,video') && (bgOf(s) || parseFloat(s.borderTopWidth) > 0) && shown(el)) {
        blocks.push({ s: selOf(el), r: R(r), f: mode === 'group' ? !seen.has(el) : undefined, g: G(el) });
        if (mode === 'mark') b1.push(el);
      }
      const name = (typeof el.className === 'string' ? el.className : '') + ' ' + el.id + ' ' + (el.getAttribute('data-testid') || '') + ' ' + (el.getAttribute('aria-label') || '');
      if (el.getAttribute('aria-busy') === 'true' && shown(el)) ind.push({ sig: 'aria-busy', s: selOf(el), r: R(r) });
      if ((el.getAttribute('role') === 'progressbar' || el.tagName === 'PROGRESS') && shown(el)) ind.push({ sig: 'progressbar', s: selOf(el), r: R(r) });
      if (/^(status|alert)$/.test(el.getAttribute('role') || '') && LOADING_RE.test(el.textContent)) ind.push({ sig: 'status-text', s: selOf(el), r: R(r) });
      if (NAME_RE.test(name) && shown(el) && area > 0) ind.push({ sig: 'name', s: selOf(el), r: R(r) });
    }
    for (const t of texts) if (LOADING_RE.test(t.t)) ind.push({ sig: 'text', s: t.t, r: t.r });
    for (const t of hidden) if (LOADING_RE.test(t)) ind.push({ sig: 'sr-text', s: t, r: null });
    for (const a of document.getAnimations()) {
      const el = a.effect && a.effect.target;
      if (!el || a.playState !== 'running' || !(el instanceof Element)) continue;
      const timing = a.effect.getComputedTiming();
      const r = el.getBoundingClientRect();
      if (timing.iterations === Infinity && inView(r) && shown(el)) ind.push({ sig: 'css-anim', s: selOf(el) + ' @' + (a.animationName || a.id || 'waapi'), r: R(r) });
    }
    const cur = getComputedStyle(document.body || document.documentElement).cursor;
    if (/^(wait|progress)$/.test(cur)) ind.push({ sig: 'cursor', s: cur, r: null });
    const gone = mode === 'group' ? b1.map((el, i) => (!el.isConnected || !shown(el) ? i : -1)).filter((i) => i >= 0) : undefined;
    return { texts, media, blocks, ind, gone, url: location.href, vw: innerWidth, vh: innerHeight, groups: mode === 'group' ? [...gid.values()] : undefined };
  };
  lb.mutsSince = (t) => lb.muts.filter((m) => m.t >= t).length;
  lb.now = () => performance.now();
})();
