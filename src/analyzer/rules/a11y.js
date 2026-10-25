// Readability / usability rules: tap targets, tiny text, unlabeled controls,
// wrapping button labels, overly long lines, contrast (DOM approximation),
// focus indicators.

function isTextInline(el) {
  // An inline link inside a run of text (WCAG target-size exception).
  if (!RL.isInline(el)) return false;
  const block = RL.nearestBlock(el);
  const all = (block.innerText || '').trim().length;
  const own = (el.innerText || '').trim().length;
  return all > own + 10;
}

function distToRect(x, y, r) {
  const dx = Math.max(r.x - x, 0, x - r.right), dy = Math.max(r.y - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

RL.rule({
  id: 'tap-target',
  run(ctx) {
    const min = RL.options.minTapTarget || 24;
    const targets = ctx.elements.filter((el) => RL.isInteractive(el) && RL.isVisible(el)).map((el) => ({ el, r: RL.rectOf(el) })).filter((t) => t.r.w >= 1 && t.r.h >= 1);
    for (const t of targets) {
      const { el, r } = t;
      if (RL.isDisabled(el) || RL.isIgnored(el, 'tap-target')) continue;
      if (r.w >= min && r.h >= min) continue;
      const tag = el.tagName;
      if ((tag === 'INPUT' && /^(checkbox|radio)$/.test(el.type)) && (el.labels && el.labels.length)) continue;
      if (isTextInline(el)) continue;
      // The real target may be a larger interactive ancestor or a wrapping label
      const host = el.parentElement && el.parentElement.closest('a[href],button,label,[role=button]');
      if (host && host !== el) {
        const hr = host.getBoundingClientRect();
        if (hr.width >= min && hr.height >= min) continue;
      }
      // WCAG 2.5.8 spacing exception: a 24px circle around the target touches no other target.
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const crowded = targets.some((u) => {
        if (u === t || RL.containsComposed(u.el, el) || RL.containsComposed(el, u.el)) return false;
        const undersized = u.r.w < min || u.r.h < min;
        if (undersized) return Math.hypot(cx - (u.r.x + u.r.w / 2), cy - (u.r.y + u.r.h / 2)) < min;
        return distToRect(cx, cy, u.r) < min / 2;
      });
      if (!crowded) continue;
      ctx.report({ rule: 'tap-target', el, message: 'Touch target is ' + Math.round(r.w) + '×' + Math.round(r.h) + 'px and crowded by neighbouring targets; make it at least ' + min + '×' + min + 'px (44×44 recommended) or space it out.', details: { w: Math.round(r.w), h: Math.round(r.h) } });
    }
  },
});

RL.rule({
  id: 'font-size-min',
  run(ctx) {
    const min = RL.options.minFontSize || 12;
    const seen = new Set();
    for (const t of ctx.texts) {
      const block = RL.nearestBlock(t.el);
      if (seen.has(block)) continue;
      if (t.el.closest('sup,sub') || t.el.namespaceURI === 'http://www.w3.org/2000/svg') continue;
      const fs = parseFloat(RL.cs(t.el).fontSize);
      if (fs < min && t.text.length > 1 && !RL.isIgnored(t.el, 'font-size-min')) {
        seen.add(block);
        ctx.report({ rule: 'font-size-min', el: t.el, message: 'Text is ' + fs + 'px; minimum readable size is ' + min + 'px.', details: { fontSize: fs } });
      }
    }
  },
});

// ---------------------------------------------------------------------------
function accessibleName(el) {
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return aria.trim();
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((n) => n.textContent).join(' ').trim();
    if (t) return t;
  }
  if (el.labels && el.labels.length) {
    const t = Array.from(el.labels).map((l) => l.textContent).join(' ').trim();
    if (t) return t;
  }
  const text = (el.innerText || el.textContent || '').trim();
  if (text) return text;
  const img = el.querySelector('img[alt]:not([alt=""]), svg title, [aria-label]');
  if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || img.textContent;
  if (el.title && el.title.trim()) return el.title.trim();
  if (el.tagName === 'INPUT' && /^(submit|reset|button)$/.test(el.type)) return el.value || el.type;
  if (el.tagName === 'INPUT' && el.type === 'image') return el.alt;
  return '';
}

RL.rule({
  id: 'unlabeled-control',
  run(ctx) {
    for (const el of ctx.elements) {
      const tag = el.tagName;
      const isInput = (tag === 'INPUT' && !/^(hidden|submit|reset|button|image)$/.test(el.type)) || tag === 'SELECT' || tag === 'TEXTAREA';
      const isBtn = tag === 'BUTTON' || (tag === 'A' && el.hasAttribute('href')) || el.getAttribute('role') === 'button';
      if (!isInput && !isBtn) continue;
      if (!RL.isVisible(el) || RL.isIgnored(el, 'unlabeled-control')) continue;
      if (accessibleName(el)) continue;
      if (isInput && el.placeholder) {
        ctx.report({ rule: 'unlabeled-control', el, severity: 'warn', message: 'Form field has only a placeholder ("' + el.placeholder.slice(0, 40) + '") and no label; the hint disappears while typing and screen readers may skip it.' });
        continue;
      }
      ctx.report({ rule: 'unlabeled-control', el, message: (isInput ? 'Form field' : 'Icon-only ' + (tag === 'A' ? 'link' : 'button')) + ' has no accessible name. Add aria-label (or a visible label).' });
    }
  },
});

// ---------------------------------------------------------------------------
function looksLikeButton(el) {
  const tag = el.tagName;
  if (tag === 'BUTTON' || el.getAttribute('role') === 'button') return true;
  if (tag === 'A' && !RL.isInline(el) && RL.hasVisibleBoundary(el)) return true;
  return false;
}

RL.rule({
  id: 'button-text-wrap',
  run(ctx) {
    const seen = new Set();
    for (const t of ctx.texts) {
      const btn = t.el.closest('button,a,[role=button]');
      if (!btn || seen.has(btn) || !looksLikeButton(btn) || RL.isIgnored(btn, 'button-text-wrap')) continue;
      const label = (btn.innerText || '').trim();
      if (!label || label.length > 40 || label.split(/\s+/).length < 2) continue;
      const lines = new Set();
      const range = document.createRange();
      range.selectNodeContents(btn);
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) lines.add(Math.round(r.top / 4));
      // merge tops that are within one line-height
      const tops = Array.from(lines).sort((a, b) => a - b);
      let count = tops.length ? 1 : 0;
      const lh = (parseFloat(RL.cs(t.el).fontSize) || 16) / 4;
      for (let i = 1; i < tops.length; i++) if (tops[i] - tops[i - 1] > lh * 0.8) count++;
      seen.add(btn);
      if (count > 1) {
        ctx.report({ rule: 'button-text-wrap', el: btn, message: 'Button label "' + label.slice(0, 40) + '" wraps onto ' + count + ' lines.', details: { lines: count } });
      }
    }
  },
});

RL.rule({
  id: 'line-length',
  run(ctx) {
    const max = RL.options.maxLineLength || 120;
    for (const el of ctx.elements) {
      if (!/^(P|LI|BLOCKQUOTE|DD)$/.test(el.tagName) || !RL.isVisible(el) || RL.isIgnored(el, 'line-length')) continue;
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (text.length < max * 2) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set();
      for (const r of range.getClientRects()) if (r.width > 1) tops.add(Math.round(r.top));
      const lines = Math.max(1, tops.size);
      const perLine = Math.round(text.length / lines);
      if (lines >= 3 && perLine > max) {
        ctx.report({ rule: 'line-length', el, message: 'Lines average ~' + perLine + ' characters; keep body text under ~' + max + ' (ideally 60–80) for readability.', details: { charsPerLine: perLine } });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Contrast. The Node runner measures contrast from real screenshots (handles
// gradients, images, overlays). In the browser-only client we approximate
// using the DOM background chain.

RL.contrastCandidates = function (texts) {
  const out = [];
  const seen = new Map();
  for (const t of texts) {
    if (RL.isIgnored(t.el, 'contrast')) continue;
    if (RL.isDisabled(t.el)) continue;
    // Text already reported as overflowing/obscured: its contrast is a symptom, not a separate defect.
    if (RL.flagged && RL.flagged.has(t.el)) continue;
    const s = RL.cs(t.el);
    const fs = parseFloat(s.fontSize) || 16;
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = fs >= 24 || (fs >= 18.66 && weight >= 700);
    const fill = s.webkitTextFillColor && s.webkitTextFillColor !== s.color ? s.webkitTextFillColor : s.color;
    let color = RL.parseColor(fill);
    const clipText = /text/.test(s.backgroundClip || '') || /text/.test(s.webkitBackgroundClip || '');
    let complex = false;
    if (t.el.namespaceURI === 'http://www.w3.org/2000/svg') {
      const f = RL.parseColor(s.fill);
      if (f) color = f;
      if (s.fill && /url\(/.test(s.fill)) complex = true;
    }
    if (clipText) complex = true;
    // masks, clip-paths, blend modes and filters change the painted color: measure real pixels
    let faded = false;
    for (let n = t.el, d = 0; n && n !== document.body && d < 25 && !faded; n = RL.parentOf(n), d++) {
      const ns = RL.cs(n);
      const mask = ns.maskImage && ns.maskImage !== 'none' ? ns.maskImage : ns.webkitMaskImage;
      // a gradient fade mask (e.g. "more content →" edge of a scroller) fades text on purpose
      if (mask && mask !== 'none' && /gradient/.test(mask) && /transparent|rgba\([^)]*,\s*0\)|\/\s*0\)/.test(mask)) faded = true;
    }
    if (faded) continue;
    for (let n = t.el, d = 0; n && n !== document.body && d < 12 && !complex; n = RL.parentOf(n), d++) {
      const ns = RL.cs(n);
      if ((ns.maskImage && ns.maskImage !== 'none') || (ns.webkitMaskImage && ns.webkitMaskImage !== 'none') ||
        (ns.clipPath && ns.clipPath !== 'none') || (ns.mixBlendMode && ns.mixBlendMode !== 'normal') || (ns.filter && ns.filter !== 'none')) complex = true;
    }
    const key = t.el;
    let entry = seen.get(key);
    if (!entry) {
      entry = { idx: out.length, el: t.el, rects: [], color, opacity: RL.effectiveOpacity(t.el), fontSize: fs, fontWeight: weight, large, complex, text: t.text.slice(0, 60) };
      seen.set(key, entry);
      out.push(entry);
    }
    for (const r of t.vis) if (entry.rects.length < 8 && r.w >= 1 && r.h >= 1) entry.rects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
  }
  // input values / placeholders
  for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]),textarea,select')) {
    if (!RL.isVisible(el) || RL.isIgnored(el, 'contrast') || RL.isDisabled(el)) continue;
    const s = RL.cs(el);
    const hasValue = el.tagName === 'SELECT' ? true : !!el.value;
    const placeholder = !hasValue && el.placeholder;
    if (!hasValue && !placeholder) continue;
    const ps = placeholder ? getComputedStyle(el, '::placeholder') : s;
    const pb = RL.paddingBox(el);
    const pad = { l: parseFloat(s.paddingLeft), r: parseFloat(s.paddingRight) };
    const fs = parseFloat(s.fontSize) || 16;
    const h = Math.min(pb.h, fs * 1.3);
    const rect = { x: pb.x + pad.l, y: pb.y + (pb.h - h) / 2, w: Math.max(4, Math.min(pb.w - pad.l - pad.r, fs * 0.55 * ((placeholder || el.value || 'xxxxxxxx').length))), h };
    out.push({ idx: out.length, el, rects: [rect], color: RL.parseColor(ps.color), opacity: RL.effectiveOpacity(el), fontSize: fs, fontWeight: parseInt(s.fontWeight, 10) || 400, large: fs >= 24, complex: false, text: (placeholder || el.value || '').slice(0, 60), placeholder: !!placeholder });
  }
  return out;
};

RL.contrastSuggestion = function (fg, bg, target) {
  // Move fg lightness toward black or white until the target ratio is met.
  const toward = RL.luminance(bg) > 0.4 ? 0 : 255;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = { r: fg.r + (toward - fg.r) * t, g: fg.g + (toward - fg.g) * t, b: fg.b + (toward - fg.b) * t, a: 1 };
    if (RL.contrast(c, bg) >= target) return RL.hex(c);
  }
  return toward === 0 ? '#000000' : '#ffffff';
};

RL.rule({
  id: 'contrast',
  domOnly: true, // the Node runner replaces this with screenshot-based measurement
  run(ctx) {
    for (const c of RL.contrastCandidates(ctx.texts)) {
      if (c.complex || !c.color) continue;
      const bg = RL.backgroundOf(c.el);
      if (!bg) continue;
      const fg = RL.blend({ ...c.color, a: c.color.a * c.opacity }, bg);
      const ratio = RL.contrast(fg, bg);
      const need = c.large ? 3 : 4.5;
      if (ratio + 0.005 < need) {
        ctx.report({
          rule: 'contrast', el: c.el, severity: c.placeholder ? 'warn' : undefined,
          message: (ratio < 1.5 ? 'Text is practically invisible: ' : 'Low contrast: ') + ratio.toFixed(2) + ':1 (needs ' + need + ':1) — ' + RL.hex(fg) + ' on ' + RL.hex(bg) + '.',
          details: { ratio: +ratio.toFixed(2), required: need, fg: RL.hex(fg), bg: RL.hex(bg), suggestion: RL.contrastSuggestion(fg, bg, need) },
        });
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Focus indicators (run as a separate phase because it changes focus).
RL.focusCheck = function (limit) {
  const issues = [];
  const style = document.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important;animation-play-state:paused!important}';
  document.head.appendChild(style);
  const props = ['outlineStyle', 'outlineWidth', 'outlineColor', 'boxShadow', 'borderTopColor', 'borderBottomColor', 'borderBottomWidth', 'backgroundColor', 'color', 'textDecorationLine', 'transform', 'filter', 'opacity'];
  const els = RL.allElements().filter((el) => RL.isInteractive(el) && RL.isVisible(el) && !RL.isDisabled(el) && el.tabIndex >= 0 && !RL.isIgnored(el, 'focus-indicator'));
  const seenSig = new Set();
  let n = 0;
  const prev = document.activeElement;
  for (const el of els) {
    if (n >= (limit || 40)) break;
    // only test one element per visual "kind" to keep this fast
    const sig = el.tagName + '|' + (typeof el.className === 'string' ? el.className : '');
    if (seenSig.has(sig)) continue;
    seenSig.add(sig);
    n++;
    const before = getComputedStyle(el);
    const b = {}; props.forEach((p) => { b[p] = before[p]; });
    const beforeAfter = getComputedStyle(el, '::after').boxShadow + getComputedStyle(el, '::after').outlineStyle + getComputedStyle(el, '::before').opacity;
    const wrap = el.parentElement;
    const wrapBefore = wrap ? getComputedStyle(wrap).boxShadow + getComputedStyle(wrap).outlineStyle + getComputedStyle(wrap).borderTopColor : '';
    el.focus({ preventScroll: true, focusVisible: true });
    if (document.activeElement !== el && !(document.activeElement && el.contains(document.activeElement))) continue;
    const after = getComputedStyle(el);
    const changed = props.some((p) => after[p] !== b[p]);
    const outlineVisible = after.outlineStyle !== 'none' && parseFloat(after.outlineWidth) > 0;
    const pseudoChanged = beforeAfter !== getComputedStyle(el, '::after').boxShadow + getComputedStyle(el, '::after').outlineStyle + getComputedStyle(el, '::before').opacity;
    const wrapChanged = wrap ? wrapBefore !== getComputedStyle(wrap).boxShadow + getComputedStyle(wrap).outlineStyle + getComputedStyle(wrap).borderTopColor : false;
    el.blur();
    if (!changed && !outlineVisible && !pseudoChanged && !wrapChanged) {
      issues.push({ rule: 'focus-indicator', ...RL.issueBase(el), message: 'No visible focus indicator: keyboard users cannot see when this ' + el.tagName.toLowerCase() + ' is focused (outline removed with no replacement).' });
    }
  }
  if (prev && prev.focus) try { prev.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  style.remove();
  return issues;
};
