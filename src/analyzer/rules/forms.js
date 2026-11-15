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

// ---------------------------------------------------------------------------
// Cramped controls: buttons that nearly touch each other, a label that nearly touches its button's border, a
// button that nearly touches the edge of the card or panel around it. Only gaps between 0.5 and 3.5px count:
// a design either joins things on purpose (0px: a button group, a full-bleed footer button) or spaces them
// (4px and up). Buttons joined on purpose have square corners where they meet, so those are left out too.
const CTL_SEL = 'button,summary,[role=button],input[type=submit],input[type=button],input[type=reset],a[href]';
function drawnApart(el) {
  // drawn as a box: a background that differs from what is behind it, borders on both sides, or an outer
  // shadow. An underline (a bottom border, an inset shadow: tabs, links) doesn't make a box.
  const s = RL.cs(el);
  const side = (n) => { const w = parseFloat(s['border' + n + 'Width']); const c = RL.parseColor(s['border' + n + 'Color']); return w > 0 && !/none|hidden/.test(s['border' + n + 'Style']) && !!c && c.a > 0.15; };
  if ((side('Left') && side('Right')) || (side('Top') && side('Bottom') && side('Left'))) return true;
  if (s.boxShadow && s.boxShadow !== 'none' && !/inset/.test(s.boxShadow) && !/^rgba\(0, 0, 0, 0\)/.test(s.boxShadow)) return true;
  const bg = RL.parseColor(s.backgroundColor);
  if (!bg || bg.a < 0.3) return false;
  const back = el.parentElement ? RL.backgroundOf(el.parentElement) : null;
  return !back || Math.abs(bg.r - back.r) + Math.abs(bg.g - back.g) + Math.abs(bg.b - back.b) > 24;
}
const cramped = (d) => d > 0.5 && d < 3.5;
// a drawn track that holds only controls (a segmented control, a toggle group, a tab pill bar) is one control
// by design: its pills sit close to its edge and to each other on purpose
function isTrack(box) {
  if (!box || !drawnApart(box)) return false;
  if (/^(group|radiogroup|tablist|toolbar|menubar)$/.test(box.getAttribute('role') || '')) return true;
  const kids = Array.from(box.children).filter((k) => RL.isVisible(k));
  return kids.length >= 2 && kids.every((k) => k.matches(CTL_SEL) || /^(tab|radio|option)$/.test(k.getAttribute('role') || ''));
}
RL.rule({
  id: 'cramped-control',
  order: 40,
  run(ctx) {
    const scope = RL.inScope();
    const ctls = Array.from(document.querySelectorAll(CTL_SEL)).filter((el) => scope(el) && RL.isVisible(el) && !RL.isIgnored(el, 'cramped-control') &&
      !RL.isOutOfFlow(el) && drawnApart(el) && (() => { const r = el.getBoundingClientRect(); return r.width >= 16 && r.height >= 16; })());
    const reported = new Set();
    const report = (el, related, message, details) => { if (reported.has(el)) return; reported.add(el); ctx.report({ rule: 'cramped-control', el, related, message, details }); };
    const radius = (el, corner) => parseFloat(RL.cs(el)['border' + corner + 'Radius']) || 0;
    // 1. a label that nearly touches its button's left or right border
    for (const el of ctls) {
      if (el.tagName === 'INPUT') continue;
      const s = RL.cs(el);
      if ((parseFloat(s.paddingLeft) || 0) >= 4 && (parseFloat(s.paddingRight) || 0) >= 4) continue;
      const rects = [];
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let n; (n = w.nextNode());) {
        if (!/\S/.test(n.nodeValue) || !n.parentElement || !RL.isVisible(n.parentElement) || RL.isVisuallyHidden(n.parentElement)) continue;
        range.selectNodeContents(n);
        rects.push(...Array.from(range.getClientRects()).filter((r) => r.width > 1 && r.height > 1));
      }
      if (!rects.length) continue;
      const b = el.getBoundingClientRect();
      const bl = parseFloat(s.borderLeftWidth) || 0, br = parseFloat(s.borderRightWidth) || 0;
      const gapL = Math.min(...rects.map((r) => r.left)) - (b.left + bl), gapR = (b.right - br) - Math.max(...rects.map((r) => r.right));
      if (gapL < -0.5 || gapR < -0.5) continue; // spills out: text-overflow's business
      const g = Math.min(gapL, gapR);
      if (g >= 3) continue;
      report(el, undefined, 'The label nearly touches the ' + (gapL <= gapR ? 'left' : 'right') + ' border of its control: ' + Math.max(0, Math.round(g * 10) / 10) + 'px of space.', { kind: 'label', gap: Math.round(g * 10) / 10 });
    }
    // 2. two controls next to each other, 0.5 to 3.5px apart (or touching, when the corners that meet are rounded)
    const rect = new Map(ctls.map((el) => [el, el.getBoundingClientRect()]));
    const byParent = new Map();
    for (const el of ctls) {
      let p = el.parentElement;
      for (let d = 0; p && d < 2 && p.children.length === 1; d++) p = p.parentElement; // <li><button>…
      if (!p) continue;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(el);
    }
    for (const [parent, list] of byParent) {
      if (list.length < 2 || list.length > 40 || isTrack(parent)) continue;
      for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        const a = list[i], b = list[j], ra = rect.get(a), rb = rect.get(b);
        if (a.contains(b) || b.contains(a)) continue;
        const vOver = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top), hOver = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        let gap = null, meet = null;
        if (vOver > Math.min(ra.height, rb.height) * 0.5 && rb.left >= ra.left) { gap = rb.left - ra.right; meet = Math.min(radius(a, 'TopRight'), radius(a, 'BottomRight'), radius(b, 'TopLeft'), radius(b, 'BottomLeft')); }
        else if (hOver > Math.min(ra.width, rb.width) * 0.5 && rb.top >= ra.top) { gap = rb.top - ra.bottom; meet = Math.min(radius(a, 'BottomLeft'), radius(a, 'BottomRight'), radius(b, 'TopLeft'), radius(b, 'TopRight')); }
        if (gap === null || meet < 2) continue; // square where they meet: joined on purpose (a segmented group)
        if (!(cramped(gap) || (gap > -0.5 && gap <= 0.5))) continue;
        report(b, a, (gap <= 0.5 ? 'These controls touch' : 'These controls nearly touch: ' + Math.round(gap * 10) / 10 + 'px apart') + ', so they read as one and are easy to mis-tap.', { kind: 'gap', gap: Math.round(gap * 10) / 10 });
      }
    }
    // 3. a control 0.5 to 3.5px from the inner edge of the card or panel around it
    for (const el of ctls) {
      const r = rect.get(el);
      let box = null;
      for (let p = el.parentElement, d = 0; p && p !== document.body && d < 4; p = p.parentElement, d++) {
        if (p.matches(CTL_SEL) || RL.isScrollContainer(p, 'x') || RL.isScrollContainer(p, 'y')) break;
        if (drawnApart(p)) { box = p; break; }
      }
      if (!box || isTrack(box) || box.querySelector('input:not([type=hidden]),select,textarea')) continue; // an input group joins its button on purpose
      const s = RL.cs(box), b = box.getBoundingClientRect();
      const inner = { left: b.left + (parseFloat(s.borderLeftWidth) || 0), right: b.right - (parseFloat(s.borderRightWidth) || 0), top: b.top + (parseFloat(s.borderTopWidth) || 0), bottom: b.bottom - (parseFloat(s.borderBottomWidth) || 0) };
      const d = { left: r.left - inner.left, right: inner.right - r.right, top: r.top - inner.top, bottom: inner.bottom - r.bottom };
      const side = Object.keys(d).find((k) => cramped(d[k]));
      if (!side) continue;
      report(el, box, 'This control sits ' + Math.round(d[side] * 10) / 10 + 'px from the ' + side + ' edge of the box around it: it looks jammed against the edge.', { kind: 'edge', side, gap: Math.round(d[side] * 10) / 10 });
    }
  },
});
