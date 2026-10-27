// Form-control polish: controls that render, but are built wrong. Stretched
// checkboxes, icons drawn over input text, squashed inputs, mismatched control
// heights, off-center icons. The dropdown-arrow rule needs pixels: candidates
// are collected here and measured from a screenshot (src/controls.js).

const TEXT_TYPES = /^(text|search|email|password|url|tel|number|date|datetime-local|month|time|week)$/;
function isTextField(el) {
  const t = el.tagName;
  if (t === 'TEXTAREA' || t === 'SELECT') return true;
  return t === 'INPUT' && TEXT_TYPES.test((el.getAttribute('type') || 'text').toLowerCase());
}
RL.isTextField = isTextField;

function boxes(el) {
  const r = RL.rectOf(el), s = RL.cs(el);
  const px = (k) => parseFloat(s[k]) || 0;
  const inner = { x: r.x + px('borderLeftWidth'), y: r.y + px('borderTopWidth'), right: r.right - px('borderRightWidth'), bottom: r.bottom - px('borderBottomWidth') };
  const content = { x: inner.x + px('paddingLeft'), y: inner.y + px('paddingTop'), right: inner.right - px('paddingRight'), bottom: inner.bottom - px('paddingBottom') };
  for (const b of [inner, content]) { b.w = b.right - b.x; b.h = b.bottom - b.y; }
  return { r, inner, content };
}

// Line boxes of the text inside `root`, skipping `skip`'s subtree.
function textLines(root, skip, max) {
  const lines = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n && lines.length < (max || 8); n = walker.nextNode()) {
    if (!n.data.trim() || (skip && skip.contains(n)) || !n.parentElement || !RL.isVisible(n.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1) lines.push(RL.docRect(q));
  }
  return lines;
}

function labelFor(el) {
  const wrap = el.closest('label');
  if (wrap) return wrap;
  if (el.labels && el.labels.length) return el.labels[0];
  for (let s = el.nextElementSibling; s; s = s.nextElementSibling) if ((s.textContent || '').trim()) return s;
  return null;
}

RL.rule({
  id: 'checkbox-layout',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName !== 'INPUT' || !/^(checkbox|radio)$/.test(el.type)) continue;
      if (!RL.isVisible(el) || RL.isIgnored(el, 'checkbox-layout')) continue;
      const r = RL.rectOf(el);
      if (r.w < 4 || r.h < 4) continue;
      const kind = el.type === 'radio' ? 'radio button' : 'checkbox';
      if (r.w > 2 * r.h && r.w > 32 && r.h <= 48) {
        ctx.report({ rule: 'checkbox-layout', el, message: 'A ' + kind + ' is stretched to ' + Math.round(r.w) + 'px wide, so the box is drawn in the middle of that space, away from its label (usually a global `input { width: 100% }`).', details: { width: Math.round(r.w), height: Math.round(r.h) } });
        continue;
      }
      const s = RL.cs(el);
      if (s.position === 'absolute' || s.position === 'fixed') continue;
      const label = labelFor(el);
      if (!label) continue;
      const first = textLines(label, el, 1)[0];
      if (!first) continue;
      // The label's first line starts below the box: the box sits on a row of its own.
      if (first.y >= r.bottom - 1 && first.y - r.bottom < 80) {
        ctx.report({ rule: 'checkbox-layout', el, related: label, message: 'The ' + kind + ' sits on its own row above its label instead of beside it.', details: { gap: Math.round(first.y - r.bottom) } });
      }
    }
  },
});

RL.rule({
  id: 'input-icon-overlap',
  run(ctx) {
    for (const el of ctx.elements) {
      if (!isTextField(el) || el.tagName === 'TEXTAREA' || !RL.isVisible(el) || RL.isIgnored(el, 'input-icon-overlap')) continue;
      const { content } = boxes(el);
      if (content.w <= 0 || content.h <= 0) continue;
      // Icons are siblings drawn on top of the field (inside a relative wrapper).
      const scope = el.parentElement && el.parentElement.parentElement ? el.parentElement : null;
      if (!scope) continue;
      for (const icon of scope.querySelectorAll('svg, img, i, [class*="icon" i]')) {
        if (icon.contains(el) || (icon.parentElement && icon.parentElement.closest('svg')) || !RL.isVisible(icon)) continue;
        const ir = RL.rectOf(icon);
        if (ir.w < 6 || ir.h < 6 || ir.w > 40 || ir.h > 40) continue;
        const hit = RL.intersect(ir, content);
        if (!hit || hit.w < 4 || hit.h < ir.h * 0.5) continue;
        const left = ir.x + ir.w / 2 < content.x + content.w / 2;
        ctx.report({ rule: 'input-icon-overlap', el, related: icon, message: 'An icon is drawn over the area where the field shows its text and placeholder (' + Math.round(hit.w) + 'px of overlap on the ' + (left ? 'left' : 'right') + '). Typed text will run underneath it.', details: { overlap: Math.round(hit.w), side: left ? 'left' : 'right' } });
        break;
      }
    }
  },
});

RL.rule({
  id: 'squashed-control',
  run(ctx) {
    for (const el of ctx.elements) {
      if (!isTextField(el) || el.tagName === 'TEXTAREA' || !RL.isVisible(el) || RL.isIgnored(el, 'squashed-control')) continue;
      const fs = parseFloat(RL.cs(el).fontSize) || 16;
      const { r, inner, content } = boxes(el);
      if (r.h < 4 || r.w < 20) continue;
      // A <select> keeps its padding and clips the text; an <input> drops padding
      // that doesn't fit and centers the text, which only breaks once the box is
      // shorter than the glyphs and they run into the border.
      const select = el.tagName === 'SELECT';
      const room = select ? content.h : inner.h;
      if (room < fs * (select ? 0.9 : 1.1)) {
        ctx.report({ rule: 'squashed-control', el, message: 'The field is too short for its text: ' + Math.max(0, Math.round(room)) + 'px of room ' + (select ? 'inside the padding' : 'inside the border') + ' for ' + Math.round(fs) + 'px text, so the text is ' + (select ? 'cut off at the top and bottom' : 'squeezed against the border') + '.', details: { room: Math.round(room), fontSize: fs, height: Math.round(r.h) } });
      }
    }
  },
});

function isControlBox(el) {
  const t = el.tagName;
  if (t === 'INPUT') {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (!TEXT_TYPES.test(type) && !/^(submit|button|reset)$/.test(type)) return false;
  } else if (t !== 'SELECT' && t !== 'BUTTON' && el.getAttribute('role') !== 'combobox') {
    if (t !== 'A' || RL.isInline(el)) return false; // button-styled links only
    if ((el.textContent || '').trim().length > 40) return false;
  }
  return RL.hasVisibleBoundary(el);
}

// A box that hugs its controls (segmented control, input group) is what lines up visually.
function groupFrame(el, h) {
  let p = el.parentElement;
  for (let i = 0; i < 3 && p && p !== document.body; i++, p = p.parentElement) {
    if (!RL.hasVisibleBoundary(p)) continue;
    const ph = p.getBoundingClientRect().height;
    const onlyControls = Array.from(p.children).every((c) => /^(BUTTON|INPUT|SELECT|LABEL)$/.test(c.tagName) || /^(radio|tab|button)$/.test(c.getAttribute('role') || ''));
    return onlyControls && ph >= h && ph < h + 16 ? p : null;
  }
  return null;
}

RL.rule({
  id: 'control-height-mismatch',
  run(ctx) {
    const items = [];
    const seen = new Set();
    for (let el of ctx.elements) {
      if (!isControlBox(el) || !RL.isVisible(el) || RL.isIgnored(el, 'control-height-mismatch')) continue;
      let r = RL.rectOf(el);
      if (r.h < 24 || r.h > 80 || r.w < 24) continue;
      const frame = groupFrame(el, r.h);
      if (frame) { el = frame; r = RL.rectOf(frame); }
      if (seen.has(el)) continue;
      seen.add(el);
      // Boxes that grow with wrapped content (chips in a multi-select, two-line buttons) are taller by design.
      if (!isTextField(el)) {
        const ls = textLines(el, null, 12);
        if (ls.some((q) => q.y > ls[0].y + ls[0].h * 0.6)) continue;
      }
      items.push({ el, r });
    }
    items.sort((a, b) => a.r.x - b.r.x);
    const done = new Set();
    for (const a of items) {
      for (const b of items) {
        if (a === b || done.has(a.el) || done.has(b.el)) continue;
        const gap = b.r.x - a.r.right;
        if (gap < -1 || gap > 24) continue;
        if (RL.containsComposed(a.el, b.el) || RL.containsComposed(b.el, a.el)) continue;
        const ov = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.y, b.r.y);
        const lo = Math.min(a.r.h, b.r.h), hi = Math.max(a.r.h, b.r.h);
        if (ov < lo * 0.5 || hi - lo < 4 || (hi - lo) / hi < 0.08) continue;
        done.add(a.el); done.add(b.el);
        ctx.report({ rule: 'control-height-mismatch', el: a.el, related: b.el, message: 'Controls side by side have different heights (' + Math.round(a.r.h) + 'px and ' + Math.round(b.r.h) + 'px), so their edges don\'t line up.', details: { heights: [Math.round(a.r.h), Math.round(b.r.h)] } });
      }
    }
  },
});

RL.rule({
  id: 'icon-misaligned',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName.toLowerCase() !== 'svg' || (el.parentElement && el.parentElement.closest('svg'))) continue;
      if (!RL.isVisible(el) || RL.isIgnored(el, 'icon-misaligned')) continue;
      const ir = RL.rectOf(el);
      if (ir.w < 8 || ir.h < 8 || ir.w > 32 || ir.h > 32) continue;
      // The nearest non-empty sibling on either side must be a single line of text.
      let lines = null;
      for (const dir of ['previousSibling', 'nextSibling']) {
        let n = el[dir];
        while (n && n.nodeType === 3 && !n.data.trim()) n = n[dir];
        if (!n || (n.nodeType === 1 && (n.tagName.toLowerCase() === 'svg' || !RL.isVisible(n)))) continue;
        let ls;
        if (n.nodeType === 3) { const range = document.createRange(); range.selectNodeContents(n); ls = Array.from(range.getClientRects()).filter((q) => q.width > 1).map(RL.docRect); }
        else ls = textLines(n, null, 4);
        if (!ls.length || ls.some((q) => Math.abs(q.y - ls[0].y) > 2)) continue;
        const near = ls.reduce((best, q) => (Math.max(q.x - ir.right, ir.x - q.right) < Math.max(best.x - ir.right, ir.x - best.right) ? q : best));
        if (Math.max(near.x - ir.right, ir.x - near.right) > 16) continue;
        if (Math.min(near.bottom, ir.bottom) - Math.max(near.y, ir.y) <= 0) continue;
        lines = near;
        break;
      }
      if (!lines) continue;
      const diff = (ir.y + ir.h / 2) - (lines.y + lines.h / 2);
      if (Math.abs(diff) > Math.max(3, lines.h * 0.2)) {
        ctx.report({ rule: 'icon-misaligned', el, message: 'The icon sits ' + Math.round(Math.abs(diff)) + 'px ' + (diff < 0 ? 'above' : 'below') + ' the center of the text next to it.', details: { offset: Math.round(diff) } });
      }
    }
  },
});

// Dropdown-arrow candidates for the pixel pass: single-value selects and
// select-like triggers that draw a box.
RL.dropdownCandidates = function () {
  RL.resetCaches();
  const out = [];
  for (const el of document.querySelectorAll('select, [role="combobox"], [aria-haspopup="listbox"]')) {
    if (el.tagName === 'SELECT' ? (el.multiple || el.size > 1) : el.tagName === 'INPUT') continue;
    if (!RL.isVisible(el) || RL.isIgnored(el, 'dropdown-arrow') || RL.isDevTool(el)) continue;
    const { r, inner } = boxes(el);
    if (r.w < 60 || r.h < 24 || r.h > 80 || !RL.hasVisibleBoundary(el)) continue;
    const s = RL.cs(el);
    out.push({ inner, radius: parseFloat(s.borderTopRightRadius) || 0, native: el.tagName === 'SELECT' && s.appearance !== 'none', base: RL.issueBase(el) });
    if (out.length >= 40) break;
  }
  return out;
};
