// The UX pass (--ux): the actions a user can take on the page (buttons, tabs, in-app links, form
// submits, filter dropdowns), one per kind, and the form fields to fill with test data before
// submitting; what the page shows with its lists empty; the dialogs actions open.

const UX_SEL = 'button, [role=button], [role=tab], a[href], input[type=submit], input[type=button], select';
const SKIP_LABEL = /\b(log ?out|sign ?out|logout|signout)\b/i;
// a label's own text, without the text of the control inside it (a <select>'s options)
const labelText = (l) => Array.from(l.childNodes).filter((n) => !(n.nodeType === 1 && /^(SELECT|INPUT|TEXTAREA|DATALIST)$/.test(n.tagName))).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
const selectLabel = (el) => el.getAttribute('aria-label') || (el.labels && el.labels[0] ? labelText(el.labels[0]) : '') || el.title || el.name || '';
const uxLabel = (el) => (el.tagName === 'SELECT' ? selectLabel(el) : el.getAttribute('aria-label') || el.textContent || el.value || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
// another option to pick in a <select> (a filter, a sort order)
const otherOption = (el) => { const o = Array.from(el.options).find((x) => !x.disabled && x.value !== el.value && !x.hidden); return o ? { value: o.value, text: o.textContent.trim().slice(0, 40) } : null; };
const norm = (s) => s.replace(/\d+/g, '#');
function uxHref(el) {
  if (el.tagName !== 'A') return '';
  try { const u = new URL(el.href, location.href); return u.origin === location.origin ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
}
function uxKind(el) {
  if (el.tagName === 'A') return 'link';
  if (el.tagName === 'SELECT') return 'select';
  if (el.getAttribute('role') === 'tab') return 'tab';
  const form = el.form || el.closest('form');
  const type = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
  return form && type === 'submit' ? 'submit' : 'button';
}
function uxCandidates() {
  const out = [], seen = new Map();
  for (const el of document.querySelectorAll(UX_SEL)) {
    if (el.closest('#__renderlint_overlay') || RL.isDevTool(el) || !RL.isVisible(el) || RL.isDisabled(el)) continue;
    if (el.getAttribute('aria-disabled') === 'true' || (el.getAttribute('type') || '').toLowerCase() === 'reset') continue;
    if (el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-current') === 'page') continue; // where the user already is
    if (RL.isIgnored(el, 'action-feedback')) continue;
    if (el.tagName === 'SELECT') {
      // a field of a form that has its own submit (filled with test data then), or nothing else to pick
      const form = el.form || el.closest('form');
      if (el.multiple || (form && form.querySelector('button:not([type=button]):not([type=reset]), input[type=submit]')) || !otherOption(el)) continue;
    }
    const label = uxLabel(el);
    if (SKIP_LABEL.test(label)) continue;
    const href = uxHref(el);
    if (href === null) continue; // another site
    if (el.tagName === 'A') {
      const raw = el.getAttribute('href') || '';
      if (el.target === '_blank' || el.hasAttribute('download') || /^(mailto:|tel:|javascript:|#$)/i.test(raw)) continue;
      const here = location.pathname + location.search + location.hash;
      if (href === here || (raw.startsWith('#') && !/^#\//.test(raw))) continue; // this page, or an anchor on it
    }
    const base = el.tagName + '|' + label + '|' + (href || '');
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    out.push({ el, key: base + '|' + n, group: el.tagName + '|' + norm(label) + '|' + norm(href || ''), label, href, kind: uxKind(el) });
  }
  return out;
}
// One action per kind (repeated rows' "View" buttons, links to /orders/1, /orders/2…), at most max.
RL.uxActions = function (max) {
  RL.resetCaches();
  const groups = new Set(), out = [];
  for (const c of uxCandidates()) {
    if (groups.has(c.group)) continue;
    groups.add(c.group);
    out.push({ key: c.key, label: c.label, href: c.href, kind: c.kind });
    if (out.length >= max) break;
  }
  return out;
};
// Marks the action with data-rl-ux; returns where it is, or null when it isn't on the page.
RL.uxMark = function (key) {
  RL.resetCaches();
  for (const e of document.querySelectorAll('[data-rl-ux]')) e.removeAttribute('data-rl-ux');
  const c = uxCandidates().find((x) => x.key === key);
  if (!c) return null;
  c.el.setAttribute('data-rl-ux', '1');
  c.el.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = c.el.getBoundingClientRect();
  return { ...RL.issueBase(c.el), vrect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, ...(c.kind === 'select' ? { option: otherOption(c.el) } : {}) };
};
// The fields of the marked action's form, marked data-rl-ux-field=i, for the runner to fill.
RL.uxFields = function () {
  const el = document.querySelector('[data-rl-ux]');
  const form = el && (el.form || el.closest('form'));
  if (!form) return [];
  const out = [];
  let i = 0;
  for (const f of form.querySelectorAll('input, textarea, select')) {
    const type = (f.getAttribute('type') || f.tagName).toLowerCase();
    if (/^(hidden|submit|button|reset|image|file)$/.test(type) || f.disabled || f.readOnly || !RL.isVisible(f)) continue;
    f.setAttribute('data-rl-ux-field', String(i));
    const label = (f.labels && f.labels[0] ? labelText(f.labels[0]) : '') || f.getAttribute('aria-label') || f.placeholder || '';
    out.push({ i: i++, tag: f.tagName.toLowerCase(), type, name: f.name || f.id || '', label: label.trim().slice(0, 60), autocomplete: f.getAttribute('autocomplete') || '',
      required: f.required, min: f.getAttribute('min'), max: f.getAttribute('max'), minLength: f.minLength > 0 ? f.minLength : 0, pattern: f.getAttribute('pattern') || '', filled: !!f.value && type !== 'checkbox' && type !== 'radio', checked: !!f.checked });
  }
  return out;
};
// The marked action's form would be submitted (the browser's own validation passes).
RL.uxFormValid = function () {
  const el = document.querySelector('[data-rl-ux]');
  const form = el && (el.form || el.closest('form'));
  return !form || form.checkValidity();
};

// ---- empty data: the page loaded with its lists of records emptied (a new account), against the
// page with its data. Texts compare with their numbers left out ("Orders (12)" is "Orders (0)").
const SIDE_SEL = 'nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[role=complementary]';
const numless = (t) => t.replace(/\d[\d,.\s]*/g, '#');
// where an element sits, the same in two loads of the page: tag#id.class from <body> down (no
// sibling numbers: a section left out would shift them)
const sigOf = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
const pathOf = (el) => { const out = []; for (let a = el; a && a !== document.documentElement; a = a.parentElement) out.push(sigOf(a)); return out.reverse().join('>'); };
function screenTexts(fn) {
  const w = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n; (n = w.nextNode());) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!t || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION)$/.test(el.tagName) || ours(el) || !shownEl(el)) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width * r.height < 16 || !inViewR(r)) continue;
    fn(el, t.slice(0, 80), r);
  }
}
// the texts on screen: key (numbers left out), on a side landmark (nav, header…), error or loading text
RL.uxTexts = function () {
  RL.resetCaches();
  const out = [];
  screenTexts((el, t, r) => { const side = !!el.closest(SIDE_SEL); out.push({ k: numless(t), t, r: vrect(r), side, err: ERROR_RE.test(t), load: t.length < 60 && LOADING_RE.test(t), ...(side ? {} : { p: pathOf(el) }) }); });
  return out;
};
// On the page with its data: the content that the empty page doesn't have (emptyKeys: its texts),
// grouped by the nearest container that still showed something there (a table keeps its header,
// a card its title). A section that the empty page leaves out entirely, title and all, is a choice
// (hide what has nothing to show), not a missing empty state.
RL.uxEmptyGroups = function (emptyKeys) {
  RL.resetCaches();
  const left = new Map();
  for (const k of emptyKeys) left.set(k, (left.get(k) || 0) + 1);
  const kept = new Set(), missing = [];
  screenTexts((el, t, r) => {
    const k = numless(t), n = left.get(k) || 0;
    if (n) { left.set(k, n - 1); for (let a = el; a; a = a.parentElement) kept.add(a); return; }
    if (!el.closest(SIDE_SEL)) missing.push({ el, t, r });
  });
  const groups = new Map();
  for (const m of missing) {
    let c = m.el;
    while (c && !kept.has(c)) c = c.parentElement;
    c = c || document.body;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(m);
  }
  const vp = innerWidth * innerHeight, out = [];
  const containers = Array.from(groups.keys());
  for (const [c, items] of groups) {
    if (RL.isIgnored(c, 'empty-state')) continue;
    let r = null;
    for (const m of items) { const b = vrect(m.r); r = r ? { x: Math.min(r.x, b.x), y: Math.min(r.y, b.y), w: Math.max(r.x + r.w, b.x + b.w) - Math.min(r.x, b.x), h: Math.max(r.y + r.h, b.y + b.h) - Math.min(r.y, b.y) } : b; }
    if (items.length < 3 && r.w * r.h < vp * 0.02) continue;
    items.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
    const head = (m) => m.el.closest('h1,h2,h3,h4,h5,h6,[role=heading]');
    const top = head(items[0]);
    // a section hidden with its title (not the page's own h1: then the page itself is gone)
    if (top && top.tagName !== 'H1' && top.getAttribute('aria-level') !== '1' && items.filter((m) => { const h = head(m); return h && h.tagName === top.tagName; }).length === 1) continue;
    const sample = [];
    for (const m of items) { const whole = m.el.textContent.replace(/\s+/g, ' ').trim(); const t = whole.length <= 40 ? whole : m.t; if (sample[sample.length - 1] !== t) sample.push(t); if (sample.length >= 4) break; }
    // the area an empty-state message for it would be in: up to the nearest ancestor shared with another group
    let card = c;
    for (let a = c.parentElement; a && a !== document.documentElement; a = a.parentElement) { if (containers.some((o) => o !== c && a.contains(o))) break; card = a; }
    out.push({ ...RL.issueBase(c), rect: r, card: pathOf(card), n: items.length, sample });
  }
  return out.sort((a, b) => b.n - a.n);
};

// ---- dialogs an action opens: focus moves in, Escape closes, focus comes back
const DIALOG_SEL = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]';
const CLOSE_LABEL = /^(×|✕|✖|x|close|cancel|dismiss|done|ok|okay|got it|no thanks|not now)$/i;
const openDialogs = () => Array.from(document.querySelectorAll(DIALOG_SEL)).filter((d) => !ours(d) && shownEl(d) && d.getClientRects().length);
RL.uxDialogMark = function () { RL.resetCaches(); for (const d of openDialogs()) d.setAttribute('data-rl-ux-was', '1'); };
// the dialog the action opened, if any (big enough to be one: not a tooltip or a small popover)
RL.uxDialog = function () {
  RL.resetCaches();
  for (const e of document.querySelectorAll('[data-rl-ux-dialog],[data-rl-ux-closer]')) { e.removeAttribute('data-rl-ux-dialog'); e.removeAttribute('data-rl-ux-closer'); }
  const vp = innerWidth * innerHeight;
  const d = openDialogs().filter((x) => !x.hasAttribute('data-rl-ux-was') && !x.closest('[data-rl-ux-was]')).find((x) => { const r = x.getBoundingClientRect(); return r.width * r.height >= vp * 0.04; });
  if (!d) return null;
  d.setAttribute('data-rl-ux-dialog', '1');
  const a = document.activeElement;
  const closer = Array.from(d.querySelectorAll('button,[role=button],a[href]')).find((b) => shownEl(b) && (CLOSE_LABEL.test((b.textContent || '').trim()) || /close|dismiss/i.test(b.getAttribute('aria-label') || b.title || '')));
  if (closer) closer.setAttribute('data-rl-ux-closer', '1');
  const r = d.getBoundingClientRect();
  return { ...RL.issueBase(d), vrect: vrect(r), focusIn: !!a && (a === d || d.contains(a)), closer: closer ? uxLabel(closer) || 'close' : '' };
};
// is the dialog still open, and where is focus: 'inside' it, on the 'trigger', lost to the 'body', or 'elsewhere'
RL.uxDialogState = function () {
  const d = document.querySelector('[data-rl-ux-dialog]');
  const open = !!d && d.isConnected && shownEl(d) && d.getClientRects().length > 0 && !(d.tagName === 'DIALOG' && !d.open);
  const a = document.activeElement;
  const t = document.querySelector('[data-rl-ux]');
  const focus = !a || a === document.body || a === document.documentElement ? 'body' : d && d.contains(a) ? 'inside' : t && (t === a || t.contains(a)) ? 'trigger' : 'elsewhere';
  return { open, focus };
};
