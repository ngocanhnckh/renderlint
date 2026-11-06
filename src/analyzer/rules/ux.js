// The UX pass (--ux): the actions a user can take on the page (buttons, tabs, in-app links, form
// submits), one per kind, and the form fields to fill with test data before submitting.

const UX_SEL = 'button, [role=button], [role=tab], a[href], input[type=submit], input[type=button]';
const SKIP_LABEL = /\b(log ?out|sign ?out|logout|signout)\b/i;
const uxLabel = (el) => (el.getAttribute('aria-label') || el.textContent || el.value || el.title || '').replace(/\s+/g, ' ').trim().slice(0, 60);
const norm = (s) => s.replace(/\d+/g, '#');
function uxHref(el) {
  if (el.tagName !== 'A') return '';
  try { const u = new URL(el.href, location.href); return u.origin === location.origin ? u.pathname + u.search + u.hash : null; } catch (e) { return null; }
}
function uxKind(el) {
  if (el.tagName === 'A') return 'link';
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
  return { ...RL.issueBase(c.el), vrect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } };
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
    const label = (f.labels && f.labels[0] ? f.labels[0].textContent : '') || f.getAttribute('aria-label') || f.placeholder || '';
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
