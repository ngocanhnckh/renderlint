// Content rules: emoji, leaked placeholders, broken / distorted images,
// dead links, invalid nesting, missing viewport meta.

RL.rule({
  id: 'emoji',
  run(ctx) {
    const seen = new Set();
    const hit = (el, chars, where) => {
      if (seen.has(el) || RL.isIgnored(el, 'emoji')) return;
      seen.add(el);
      const uniq = Array.from(new Set(chars)).slice(0, 6).join(' ');
      ctx.report({
        rule: 'emoji', el,
        message: 'Emoji used in the UI' + (where ? ' (' + where + ')' : '') + ': ' + uniq + '. Use an icon from an icon set (SVG) instead.',
        details: { emoji: Array.from(new Set(chars)) },
      });
    };
    for (const t of ctx.texts) {
      const m = t.text.match(RL.EMOJI_RE);
      if (m) hit(t.el, m);
    }
    for (const el of ctx.elements) {
      for (const pseudo of ['::before', '::after']) {
        const c = getComputedStyle(el, pseudo).content;
        if (!c || c === 'none' || c === 'normal' || c.length < 3) continue;
        const m = c.match(RL.EMOJI_RE);
        if (m && RL.isVisible(el)) hit(el, m, pseudo + ' content');
      }
      const tag = el.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && RL.isVisible(el)) {
        const m = ((el.value || '') + ' ' + (el.placeholder || '')).match(RL.EMOJI_RE);
        if (m) hit(el, m, 'input text');
      }
    }
  },
});

// ---------------------------------------------------------------------------
const LEAK_PATTERNS = [
  [/\[object (Object|Promise|Array)\]/, 'error', 'a stringified JavaScript object'],
  [/^(undefined|null|NaN|Infinity|-Infinity)$/, 'error', 'a raw JavaScript value'],
  [/(^|[\s$€£¥(])(undefined|NaN)(?=$|[\s%).,!?:])/, 'error', 'a raw JavaScript value'],
  [/\bInvalid Date\b/, 'error', '"Invalid Date"'],
  [/\{\{\s*[\w.$[\]'"]+\s*\}\}|\$\{\s*[\w.$]+\s*\}/, 'error', 'an unrendered template expression'],
  [/\blorem ipsum\b|\bdolor sit amet\b/i, 'warn', 'placeholder "lorem ipsum" copy'],
  [/^(TODO|FIXME|TBD|XXX)\b|\b(TODO|FIXME):/, 'warn', 'a TODO/FIXME note'],
  [/\b(Your|Company|Product|Brand) (Name|Logo) Here\b|^(Image|Logo|Title|Heading|Placeholder)( \d+)?$/i, 'warn', 'placeholder copy'],
];

RL.rule({
  id: 'placeholder-text',
  run(ctx) {
    const seen = new Set();
    for (const t of ctx.texts) {
      if (seen.has(t.el) || RL.isIgnored(t.el, 'placeholder-text')) continue;
      const tag = t.el.tagName;
      if (tag === 'CODE' || tag === 'PRE' || tag === 'KBD' || tag === 'SAMP' || t.el.closest('pre,code,kbd,samp,[contenteditable]')) continue;
      for (const [re, sev, what] of LEAK_PATTERNS) {
        if (re.test(t.text)) {
          seen.add(t.el);
          ctx.report({ rule: 'placeholder-text', el: t.el, severity: sev, message: 'Visible text contains ' + what + ': "' + RL.snippet(t.node, 50) + '".' });
          break;
        }
      }
    }
  },
});

// ---------------------------------------------------------------------------
RL.rule({
  id: 'broken-image',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName !== 'IMG' || !RL.isVisible(el) || RL.isIgnored(el, 'broken-image')) continue;
      const src = el.currentSrc || el.getAttribute('src') || '';
      if (!src && !el.getAttribute('srcset')) {
        ctx.report({ rule: 'broken-image', el, message: '<img> has no src.' });
      } else if (el.complete && el.naturalWidth === 0) {
        ctx.report({ rule: 'broken-image', el, message: 'Image failed to load: ' + src.slice(0, 120), details: { src } });
      }
    }
  },
});

RL.rule({
  id: 'image-distortion',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName !== 'IMG' || !RL.isVisible(el) || !el.naturalWidth || !el.naturalHeight) continue;
      if (RL.isIgnored(el, 'image-distortion')) continue;
      const src = el.currentSrc || el.src || '';
      if (/\.svg(\?|#|$)|^data:image\/svg/i.test(src)) continue;
      const s = RL.cs(el);
      if (s.objectFit && s.objectFit !== 'fill') continue;
      const pl = parseFloat(s.paddingLeft) + parseFloat(s.paddingRight) + parseFloat(s.borderLeftWidth) + parseFloat(s.borderRightWidth);
      const pt = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom) + parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
      const r = el.getBoundingClientRect();
      const w = r.width - pl, h = r.height - pt;
      if (w < 16 || h < 16) continue;
      const natural = el.naturalWidth / el.naturalHeight;
      const rendered = w / h;
      const diff = Math.abs(rendered - natural) / natural;
      if (diff > 0.06) {
        ctx.report({
          rule: 'image-distortion', el,
          message: 'Image is ' + (rendered > natural ? 'stretched horizontally' : 'squashed horizontally') + ' (' + Math.round(diff * 100) + '% off its natural aspect ratio ' + el.naturalWidth + '×' + el.naturalHeight + ', rendered ' + Math.round(w) + '×' + Math.round(h) + ').',
          details: { natural: [el.naturalWidth, el.naturalHeight], rendered: [Math.round(w), Math.round(h)] },
        });
      }
    }
  },
});

RL.rule({
  id: 'missing-alt',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName !== 'IMG' || el.hasAttribute('alt') || el.getAttribute('role') === 'presentation' || el.getAttribute('aria-hidden') === 'true') continue;
      if (!RL.isVisible(el) || RL.isIgnored(el, 'missing-alt')) continue;
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) continue;
      ctx.report({ rule: 'missing-alt', el, message: '<img> has no alt attribute (use alt="" for decorative images).' });
    }
  },
});

// ---------------------------------------------------------------------------
function hasClickHandler(el) {
  for (let n = el, d = 0; n && d < 3; n = n.parentElement, d++) {
    if (n.onclick || n.hasAttribute('onclick') || n.hasAttribute('@click') || n.hasAttribute('v-on:click') || n.hasAttribute('x-on:click') || n.hasAttribute('hx-get') || n.hasAttribute('hx-post') || n.hasAttribute('data-action')) return true;
    for (const k of Object.keys(n)) {
      if (k.startsWith('__reactProps$') && n[k] && (n[k].onClick || n[k].onMouseDown || n[k].onPointerDown)) return true;
      if (k === '_vei' && n[k] && Object.keys(n[k]).some((e) => /click|mousedown|pointerdown/i.test(e))) return true;
      if (/^__(click|mousedown|pointerdown)$/.test(k)) return true; // svelte 5 delegated events
      if (k.startsWith('jQuery') || k === '__zone_symbol__clickfalse') return true;
    }
  }
  return false;
}
RL.hasClickHandler = hasClickHandler;

RL.rule({
  id: 'dead-link',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName !== 'A' || !RL.isVisible(el) || RL.isIgnored(el, 'dead-link')) continue;
      const href = el.getAttribute('href');
      const dead = href === null ? !el.hasAttribute('name') && !el.id && RL.cs(el).cursor === 'pointer'
        : href.trim() === '' || href.trim() === '#' || /^javascript:\s*(void\(0\)|;)?\s*;?$/i.test(href.trim());
      if (!dead || hasClickHandler(el) || el.getAttribute('role') === 'button' && hasClickHandler(el)) continue;
      ctx.report({
        rule: 'dead-link', el, needsListenerCheck: true,
        message: 'Link goes nowhere (href=' + JSON.stringify(href) + ') and has no click handler.',
      });
    }
  },
});

RL.rule({
  id: 'nested-interactive',
  run(ctx) {
    for (const el of ctx.elements) {
      const tag = el.tagName;
      if (!(tag === 'A' && el.hasAttribute('href')) && tag !== 'BUTTON') continue;
      if (RL.isIgnored(el, 'nested-interactive')) continue;
      const parent = el.parentElement && el.parentElement.closest('a[href],button');
      if (parent) {
        ctx.report({ rule: 'nested-interactive', el, related: parent, message: '<' + tag.toLowerCase() + '> is nested inside <' + parent.tagName.toLowerCase() + '>; interactive elements cannot contain each other (invalid HTML, causes hydration errors and broken clicks).' });
      }
    }
  },
});

RL.rule({
  id: 'missing-viewport-meta',
  run(ctx) {
    if (document.querySelector('meta[name="viewport" i]')) return;
    if (RL.isIgnored(document.body, 'missing-viewport-meta')) return;
    ctx.report({ rule: 'missing-viewport-meta', el: document.body, message: 'No <meta name="viewport"> tag: phones will render the page at desktop width and zoom out.' });
  },
});
