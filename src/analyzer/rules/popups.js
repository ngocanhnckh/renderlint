// Open dropdowns, menus, listboxes and popovers that can't be seen: cut off by a
// container's overflow, or painted underneath another element (z-index / stacking order).
// The rule checks the ones open now (a `states` entry, a Playwright test, the live overlay);
// the runner also opens each menu trigger on the page and checks what it opens.

const POPUP_SEL = '[role=menu],[role=listbox],[role=tree],.dropdown-menu.show,[popover],details[open]>:not(summary)';
const ITEM_SEL = '[role=option],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=treeitem],.dropdown-item,a[href],button,li';
const TRIGGER_SEL = '[aria-haspopup]:not([aria-haspopup=false]):not([aria-haspopup=dialog]),[role=combobox]:not(select),[data-bs-toggle=dropdown],[data-toggle=dropdown],details>summary';

function isOpenPopup(el) {
  if (!RL.isVisible(el)) return false;
  if (el.hasAttribute('popover')) { try { if (!el.matches(':popover-open')) return false; } catch (e) { return false; } return true; }
  // a dropdown floats: it, or a wrapper close above it, is positioned out of flow (an always-visible list isn't a dropdown)
  for (let n = el, d = 0; n && n !== document.body && d < 4; n = RL.parentOf(n), d++) {
    const p = RL.cs(n).position;
    if (p === 'absolute' || p === 'fixed') return true;
  }
  return false;
}

RL.openPopups = function () {
  const out = [];
  for (const el of document.querySelectorAll(POPUP_SEL)) {
    if (out.some((o) => o.contains(el))) continue; // a submenu inside an open menu: checked with it
    if (isOpenPopup(el)) out.push(el);
  }
  return out;
};

// The element the popup's own stacking order is decided by: its nearest ancestor that starts a stacking context.
function stackingRoot(el) {
  for (let n = RL.parentOf(el); n && n !== document.documentElement; n = RL.parentOf(n)) {
    if (n.nodeType !== 1) continue;
    const s = RL.cs(n);
    const parent = RL.parentOf(n);
    const flexItem = parent && parent.nodeType === 1 && /flex|grid/.test(RL.cs(parent).display);
    const why = s.zIndex !== 'auto' && (s.position !== 'static' || flexItem) ? 'z-index: ' + s.zIndex
      : s.transform !== 'none' ? 'transform' : s.filter !== 'none' ? 'filter' : parseFloat(s.opacity) < 1 ? 'opacity'
        : s.isolation === 'isolate' ? 'isolation' : /transform|opacity|filter/.test(s.willChange || '') ? 'will-change'
          : /paint|strict|content/.test(s.contain || '') ? 'contain' : s.position === 'fixed' || s.position === 'sticky' ? 'position: ' + s.position : null;
    if (why) return { el: n, why };
  }
  return null;
}

// Does this element contain fixed-position descendants (a transform, filter, perspective or contain on it)?
function trapsFixed(s) {
  return s.transform !== 'none' || s.filter !== 'none' || s.perspective !== 'none' || (s.backdropFilter && s.backdropFilter !== 'none') ||
    /paint|layout|strict|content/.test(s.contain || '') || /transform|filter|perspective/.test(s.willChange || '');
}

// What clips an item that isn't painted at a document point: 'inside' when the popup itself (or a box in it)
// scrolls it out of view, which is by design; else the ancestor outside the popup that cuts it off. Follows
// the containing blocks: an absolutely positioned box is only clipped by positioned ancestors' overflow, and a
// fixed one only inside a transformed (or filtered…) ancestor.
function clipperAt(item, popup, x, y) {
  let inside = true, pos = RL.cs(item).position;
  let n = RL.parentOf(item);
  while (n && n !== document.body && n !== document.documentElement) {
    if (n.nodeType !== 1) { n = RL.parentOf(n); continue; }
    const s = RL.cs(n);
    const contains = pos === 'fixed' ? trapsFixed(s) : pos === 'absolute' ? s.position !== 'static' || trapsFixed(s) : true;
    if (contains) {
      const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible' || (s.clipPath && s.clipPath !== 'none');
      if (clips) {
        const r = RL.rectOf(n);
        if (x < r.x || x > r.right || y < r.y || y > r.bottom) {
          return inside ? 'inside' : { el: n, why: (s.clipPath && s.clipPath !== 'none' ? 'clip-path' : 'overflow: ' + (s.overflowY !== 'visible' ? s.overflowY : s.overflowX)) + (pos === 'fixed' && s.transform !== 'none' ? ', and its transform traps the fixed-position menu' : '') };
        }
      }
      pos = s.position === 'absolute' || s.position === 'fixed' ? s.position : 'static'; // what clips this containing block in turn
    }
    if (n === popup) inside = false;
    n = RL.parentOf(n);
  }
  return null;
}

// Hit-tests the popup's options. Returns a finding, or null when every option can be seen.
RL.popupProblem = function (popup, trigger) {
  if (RL.isIgnored(popup, 'popup-obscured') || (trigger && RL.isIgnored(trigger, 'popup-obscured'))) return null;
  let items = Array.from(popup.querySelectorAll(ITEM_SEL)).filter((i) => RL.isVisible(i) && !i.querySelector(ITEM_SEL));
  if (!items.length) items = [popup];
  items = items.slice(0, 30);
  const de = document.documentElement;
  const maxX = Math.max(de.scrollWidth, innerWidth), maxY = Math.max(de.scrollHeight, innerHeight);
  let hidden = 0, cut = null, cover = null, firstHidden = null;
  for (const item of items) {
    const r = RL.rectOf(item);
    if (r.w < 2 || r.h < 2) continue;
    let itemHidden = false;
    for (const fx of [0.5, 0.15, 0.85]) {
      const x = r.x + r.w * fx, y = r.y + r.h / 2;
      if (x < 0 || y < 0 || x >= maxX || y >= maxY) continue; // off the page: viewport-overflow's business
      const { stack } = RL.stackAt(x, y);
      const idx = stack.findIndex((e) => e === item || RL.containsComposed(item, e));
      if (idx < 0) {
        // not painted here at all: cut off by an ancestor's overflow (or clip-path), unless the popup scrolls it away itself
        const c = clipperAt(item, popup, x, y);
        if (c && c !== 'inside') { itemHidden = true; cut = cut || c; }
        continue;
      }
      for (let k = 0; k < idx; k++) {
        const e = stack[k];
        if (RL.containsComposed(popup, e) || RL.containsComposed(e, popup) || (trigger && (RL.containsComposed(trigger, e) || RL.containsComposed(e, trigger)))) continue;
        if (RL.isDevTool(e) || e.id === '__renderlint_overlay') continue;
        if (!RL.isOpaqueLayer(e)) continue;
        itemHidden = true;
        cover = cover || e;
        break;
      }
    }
    if (itemHidden) { hidden++; firstHidden = firstHidden || item; }
  }
  window.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  if (!hidden) return null;
  const what = popup.matches('[role=listbox]') || (trigger && trigger.matches('[role=combobox],[aria-haspopup=listbox]')) ? 'dropdown list' : 'menu';
  const name = trigger ? RL.describe(trigger).text : '';
  const of = `${hidden} of ${items.length} ${items.length === 1 && items[0] === popup ? 'part' : 'option' + (items.length === 1 ? '' : 's')}`;
  const opened = 'The open ' + what + (name ? ` of "${name.slice(0, 40)}"` : '');
  if (cover) {
    const root = stackingRoot(popup);
    return {
      rule: 'popup-obscured', el: firstHidden, related: cover,
      message: `${opened} is drawn underneath another element (${of} hidden behind ${RL.selector(cover)}).` +
        (root ? ` Its z-index only counts inside ${RL.selector(root.el)} (${root.why}), which sits below that element.` : ''),
      details: { kind: 'covered', coveredBy: RL.selector(cover), hidden, items: items.length, ...(root ? { stackingContext: RL.selector(root.el), stackingReason: root.why } : {}) },
    };
  }
  return {
    rule: 'popup-obscured', el: firstHidden, related: cut ? cut.el : undefined,
    message: `${opened} is cut off${cut ? ` by ${RL.selector(cut.el)} (${cut.why})` : ''}: ${of} can't be seen.`,
    details: { kind: 'clipped', ...(cut ? { clippedBy: RL.selector(cut.el), clipReason: cut.why } : {}), hidden, items: items.length },
  };
};

RL.rule({
  id: 'popup-obscured',
  order: 93,
  run(ctx) {
    for (const popup of RL.openPopups()) {
      const p = hitTestable(() => RL.popupProblem(popup, null));
      if (p) ctx.report(p);
    }
  },
});

// For the runner: menu triggers on the page, two per repeated kind (the first and the last: the
// last row's menu is the one a table's overflow cuts off). Marks them for lookup, and marks the
// popups already open so the one a click opens can be told apart.
RL.menuTriggers = function (max) {
  RL.resetCaches(); // the page changed since the last look (a menu opened or closed)
  for (const p of document.querySelectorAll(POPUP_SEL)) p.setAttribute('data-rl-was-open', isOpenPopup(p) ? '1' : '0');
  const groups = new Map();
  for (const el of document.querySelectorAll(TRIGGER_SEL)) {
    if (!RL.isVisible(el) || RL.isDisabled(el) || el.getAttribute('aria-expanded') === 'true' || RL.isIgnored(el, 'popup-obscured')) continue;
    if (el.tagName === 'SUMMARY' && el.parentElement.open) continue;
    const href = el.tagName === 'A' ? (el.getAttribute('href') || '').trim() : '';
    if (href && href !== '#' && !/^javascript:/i.test(href)) continue; // a link that navigates
    const r = RL.rectOf(el);
    if (r.w < 4 || r.h < 4) continue;
    // the same kind of trigger in the same place (each row's "Actions"), whatever its text
    const sig = (n) => n.tagName + '.' + (typeof n.className === 'string' ? n.className.trim().split(/\s+/).sort().join('.') : '');
    const chain = [];
    for (let n = el, d = 0; n && n !== document.body && d < 5; n = n.parentElement, d++) chain.push(sig(n));
    const key = [chain.join('<'), el.getAttribute('aria-haspopup') || '', el.getAttribute('role') || ''].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  const picked = [];
  for (const list of groups.values()) {
    picked.push(list[0]);
    if (list.length > 1) picked.push(list[list.length - 1]);
  }
  return picked.slice(0, max || 8).map((el, i) => { el.setAttribute('data-rl-menu', String(i)); return '[data-rl-menu="' + i + '"]'; });
};

// After a trigger was clicked: the popup it opened, checked.
// Hit-testing sees only what can receive clicks. An open menu makes the rest of the page inert (Headless UI)
// or sets pointer-events: none on it (Radix, decorative layers), yet that still paints over the menu: lift both
// for the (synchronous) check, then put them back.
function hitTestable(fn) {
  const pe = document.createElement('style');
  pe.textContent = '*{pointer-events:auto!important}';
  document.head.appendChild(pe);
  const inert = Array.from(document.querySelectorAll('[inert]'));
  for (const e of inert) e.removeAttribute('inert');
  try { return fn(); } finally {
    for (const e of inert) e.setAttribute('inert', '');
    pe.remove();
  }
}

RL.checkMenu = function (sel) {
  RL.resetCaches(); // the page changed since the last look (a menu opened or closed)
  const trigger = document.querySelector(sel);
  if (!trigger) return null;
  return hitTestable(() => findAndCheck(trigger));
};
function findAndCheck(trigger) {
  let popup = null;
  for (const id of (trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns') || '').split(/\s+/).filter(Boolean)) {
    const el = document.getElementById(id);
    if (el && RL.isVisible(el)) { popup = el.matches(POPUP_SEL) ? el : (el.querySelector('[role=listbox],[role=menu]') || el); break; }
  }
  if (!popup && trigger.tagName === 'SUMMARY') popup = Array.from(trigger.parentElement.children).find((c) => c !== trigger && RL.isVisible(c)) || null;
  if (!popup) popup = Array.from(document.querySelectorAll(POPUP_SEL)).find((p) => p.getAttribute('data-rl-was-open') !== '1' && isOpenPopup(p)) || null;
  if (!popup) return { open: false };
  const p = RL.popupProblem(popup, trigger);
  if (!p) return { open: true, issue: null };
  const { el, related, ...rest } = p;
  return { open: true, issue: { ...rest, ...RL.issueBase(el, related) } };
}

RL.menuStillOpen = function (sel) {
  RL.resetCaches(); // the page changed since the last look (a menu opened or closed)
  const trigger = document.querySelector(sel);
  if (!trigger) return false;
  if (trigger.tagName === 'SUMMARY') return trigger.parentElement.open;
  if (trigger.getAttribute('aria-expanded') === 'true') return true;
  return Array.from(document.querySelectorAll(POPUP_SEL)).some((p) => p.getAttribute('data-rl-was-open') !== '1' && isOpenPopup(p));
};
