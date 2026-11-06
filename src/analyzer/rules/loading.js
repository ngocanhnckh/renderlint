// What the user sees while the page waits for data (loading-state, action-feedback, error-feedback).
// The runner holds the page's fetch/XHR requests, takes RL.waitSnap('mark') a second into the wait,
// releases them, and takes RL.waitSnap('group') once the data is shown. The new content is grouped by
// the container it went into (the nearest element already there at the first look); the runner
// compares what each of those areas showed while waiting.

const LOADING_RE = /\b(loading|fetching|please wait|saving|submitting|processing|updating|refreshing|syncing|signing in|uploading|searching)\b|\b\w+ing\b.*(…|\.\.\.)$|\bwait\b.*(…|\.\.\.)$/i; // "Crunching numbers…", not "More…"
const NAME_RE = /skelet|spinner|\bspin\b|loader|loading|shimmer|placeholder|progress|pulse|busy/i;
const ERROR_RE = /\b(error|failed|failure|couldn['’]?t|could not|can['’]?t|cannot|unable|went wrong|try again|retry|problem|unavailable|offline|timed? ?out|denied|invalid)\b/i;

const shownEl = (el) => (el.checkVisibility ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) : RL.isVisible(el));
const inViewR = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
const vrect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
const paints = (s) => s.backgroundImage !== 'none' || (s.backgroundColor && !/rgba\(.*,\s*0\)|transparent/.test(s.backgroundColor));
const ours = (el) => !!(el.closest && el.closest('#__renderlint_overlay')) || RL.isDevTool(el);

let waitSeen = new WeakSet(), waitGroups = new Map(), waitText = [], waitBlocks = [], waitMO = null, waitMuts = 0;
const chain = (el) => { const out = []; for (let a = el; a; a = a.parentElement) out.push(a); return out; };
const pathFrom = (c, a) => { const i = c.indexOf(a); return i < 0 ? null : c.slice(0, i).reverse().map((e) => e.tagName.toLowerCase()).join('>'); };
const anchorOf = (el) => { let a = el; while (a && !waitSeen.has(a)) a = a.parentElement; return a; };
function groupOf(el) {
  const a = anchorOf(el);
  if (!a) return -1;
  if (!waitGroups.has(a)) {
    const b = RL.issueBase(a);
    waitGroups.set(a, {
      id: waitGroups.size, selector: b.selector, source: b.source, text: b.text,
      ignored: RL.isIgnored(a, 'loading-state'),
      // tag paths (from the container) of the text it held at the first look: a list that grew
      // or changed shows the same kind of rows as before
      prior: Array.from(new Set(waitText.map((c) => pathFrom(c, a)).filter((p) => p !== null))),
    });
  }
  return waitGroups.get(a).id;
}

// mode: 'mark' (first look: remember the elements, start counting DOM changes), 'group' (after the
// data: tag new content with its container), or nothing (a plain look)
RL.waitSnap = function (mode) {
  RL.resetCaches();
  if (mode === 'mark') {
    waitSeen = new WeakSet(); waitGroups = new Map(); waitText = []; waitBlocks = []; waitMuts = 0;
    for (const el of document.querySelectorAll('*')) waitSeen.add(el);
    if (waitMO) waitMO.disconnect();
    waitMO = new MutationObserver((recs) => { for (const r of recs) if (!ours(r.target)) waitMuts++; });
    waitMO.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }
  const group = mode === 'group';
  const texts = [], hidden = [], media = [], blocks = [], ind = [];
  const root = document.body || document.documentElement;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n; (n = w.nextNode());) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName) || ours(el) || !shownEl(el)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width * r.height < 16) { hidden.push(t); continue; } // visually hidden text (sr-only)
    if (!inViewR(r)) continue;
    const item = { t: t.slice(0, 80), r: vrect(r) };
    if (group) {
      item.g = groupOf(el); const a = anchorOf(el); item.p = a ? pathFrom(chain(el), a) : '';
      const whole = el.textContent.replace(/\s+/g, ' ').trim(); // "#1040", not "#" and "1040"
      if (whole.length <= 40) item.e = whole;
    }
    texts.push(item);
    if (mode === 'mark') waitText.push(chain(el));
  }
  for (const el of document.querySelectorAll('img,svg,canvas,video,picture,iframe')) {
    if (el.tagName.toLowerCase() === 'svg' && el.parentElement && el.parentElement.closest('svg')) continue;
    if (el.tagName === 'IMG' && !(el.complete && el.naturalWidth)) continue;
    if (ours(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 64 || !inViewR(r) || !shownEl(el)) continue;
    const item = { t: el.tagName.toLowerCase() + ':' + (el.getAttribute('src') || '').slice(-60), r: vrect(r) };
    if (group) { item.g = groupOf(el); item.f = !waitSeen.has(el); }
    media.push(item);
  }
  const vpArea = innerWidth * innerHeight;
  for (const el of root.querySelectorAll('*')) {
    if (ours(el)) continue;
    const r = el.getBoundingClientRect();
    if (!inViewR(r)) continue;
    const area = r.width * r.height;
    const s = RL.cs(el);
    // boxes without text that paint something: a static skeleton, chart bars
    if (area >= 60 && area < vpArea * 0.25 && !el.textContent.trim() && !el.querySelector('img,svg,canvas,video') &&
        (paints(s) || parseFloat(s.borderTopWidth) > 0) && shownEl(el)) {
      const item = { r: vrect(r) };
      if (group) { item.g = groupOf(el); item.f = !waitSeen.has(el); }
      blocks.push(item);
      if (mode === 'mark') waitBlocks.push(el);
    }
    const role = el.getAttribute('role') || '';
    const name = (typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '') + ' ' + el.id + ' ' +
      (el.getAttribute('data-testid') || '') + ' ' + (el.getAttribute('aria-label') || '');
    if (el.getAttribute('aria-busy') === 'true' && shownEl(el)) ind.push({ sig: 'aria-busy', r: vrect(r) });
    if ((role === 'progressbar' || el.tagName === 'PROGRESS') && shownEl(el)) ind.push({ sig: 'progressbar', r: vrect(r) });
    if (/^(status|alert)$/.test(role) && LOADING_RE.test(el.textContent)) ind.push({ sig: 'status', r: vrect(r) });
    if (area > 0 && NAME_RE.test(name) && shownEl(el)) ind.push({ sig: 'name', r: vrect(r) });
  }
  for (const t of texts) if (t.t.length < 60 && LOADING_RE.test(t.t)) ind.push({ sig: 'text', r: t.r });
  for (const t of hidden) if (LOADING_RE.test(t)) ind.push({ sig: 'sr-text', r: null });
  for (const a of document.getAnimations ? document.getAnimations() : []) {
    const el = a.effect && a.effect.target;
    if (!el || a.playState !== 'running' || !(el instanceof Element) || ours(el)) continue;
    const r = el.getBoundingClientRect();
    if (a.effect.getComputedTiming().iterations === Infinity && inViewR(r) && shownEl(el)) ind.push({ sig: 'animation', r: vrect(r) });
  }
  if (/^(wait|progress)$/.test(RL.cs(document.body || document.documentElement).cursor)) ind.push({ sig: 'cursor', r: null });
  const out = { texts, media, blocks, ind, vw: innerWidth, vh: innerHeight, url: location.href, title: document.title };
  if (group) {
    out.groups = Array.from(waitGroups.values());
    out.gone = waitBlocks.map((el, i) => (!el.isConnected || !shownEl(el) ? i : -1)).filter((i) => i >= 0);
  }
  return out;
};
RL.waitMutations = () => waitMuts;
// text on screen now that reads like an error message, or an alert
RL.errorShown = function () {
  RL.resetCaches();
  const out = [];
  for (const el of document.querySelectorAll('[role=alert],[aria-invalid=true],[role=status]')) if (shownEl(el) && el.textContent.trim()) out.push(el.textContent.trim().slice(0, 80));
  const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  for (let n; (n = w.nextNode());) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (t && t.length < 160 && ERROR_RE.test(t) && n.parentElement && shownEl(n.parentElement) && !ours(n.parentElement)) out.push(t.slice(0, 80));
  }
  return out;
};
