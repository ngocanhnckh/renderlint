// renderlint-ignore-file (describes placeholder/emoji rules, so it mentions their trigger words)
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

// WordPress sample content and Elementor's default widget texts, left on a published page.
// Only checked on WordPress/Elementor pages, and the generic ones only inside the widget they come from.
const WP_DEFAULTS = [
  [/^Just another WordPress site$/, null, 'the default WordPress tagline'],
  [/^Hello world!$|^Welcome to WordPress\. This is your first post\.|^This is an example page\.|^Sample Page$|^A WordPress Commenter$|^Hi, this is a comment\./, null, 'WordPress sample content'],
  [/^Add Your Heading Text Here$|^I am a description\. Click the edit button to change this text\.$|Click edit button to change this text/, null, 'Elementor\'s default widget text'],
  [/^This is the heading$/, '.elementor-widget-icon-box,.elementor-widget-image-box', 'Elementor\'s default widget text'],
  [/^Cool Number$/, '.elementor-widget-counter', 'Elementor\'s default widget text'],
  [/^(My Skill|Web Designer)$/, '.elementor-widget-progress', 'Elementor\'s default widget text'],
  [/^This is an Alert$/, '.elementor-widget-alert', 'Elementor\'s default widget text'],
  [/^List Item #\d+$/, '.elementor-widget-icon-list', 'Elementor\'s default widget text'],
  [/^(Tab|Accordion|Toggle) #\d+$/, '.elementor-widget-tabs,.elementor-widget-accordion,.elementor-widget-toggle,.elementor-widget-n-tabs,.elementor-widget-n-accordion', 'Elementor\'s default widget text'],
  [/^(John Doe|Designer)$/, '.elementor-widget-testimonial', 'Elementor\'s default widget text'],
  [/^Click here$/, '.elementor-widget-button', 'Elementor\'s default button text'],
];

RL.rule({
  id: 'placeholder-text',
  run(ctx) {
    const seen = new Set();
    const wp = RL.platform();
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
      if (seen.has(t.el) || !(wp.wordpress || wp.elementor)) continue;
      const full = (t.el.textContent || '').replace(/\s+/g, ' ').trim();
      for (const [re, scope, what] of WP_DEFAULTS) {
        if (re.test(full) && (!scope || t.el.closest(scope))) {
          seen.add(t.el);
          ctx.report({ rule: 'placeholder-text', el: t.el, severity: 'warn', message: 'Visible text is ' + what + ', never replaced: "' + RL.snippet(t.el, 50) + '".', details: { wordpress: true } });
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

RL.rule({
  id: 'oversized-icon',
  run(ctx) {
    for (const el of ctx.elements) {
      if (el.tagName.toLowerCase() !== 'svg' || (el.parentElement && el.parentElement.closest('svg'))) continue;
      const vb = el.viewBox && el.viewBox.baseVal;
      if (!vb || !vb.width || !vb.height || Math.max(vb.width, vb.height) > 48) continue; // only icon-sized artwork
      if (!RL.isVisible(el) || RL.isIgnored(el, 'oversized-icon')) continue;
      if (el.hasAttribute('width') || el.hasAttribute('height')) continue;
      const r = el.getBoundingClientRect();
      // An unsized icon stretches to its container (or its flex share); a deliberately large icon (e.g. size-28) has a CSS size.
      let unsized;
      const map = el.computedStyleMap && el.computedStyleMap();
      if (map) unsized = String(map.get('width')) === 'auto' && String(map.get('height')) === 'auto';
      else {
        const p = el.parentElement;
        const pw = p ? RL.paddingBox(p).w - (parseFloat(RL.cs(p).paddingLeft) || 0) - (parseFloat(RL.cs(p).paddingRight) || 0) : 0;
        unsized = pw > 0 && r.width >= pw * 0.9;
      }
      if (unsized && r.width >= 4 * vb.width && r.width > 96 && r.height > 64) {
        ctx.report({ rule: 'oversized-icon', el, message: 'A ' + vb.width + '×' + vb.height + ' icon is rendered at ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px — it has no size, so it stretches to fill its container.', details: { viewBox: [vb.width, vb.height], rendered: [Math.round(r.width), Math.round(r.height)] } });
      }
    }
  },
});

RL.rule({
  id: 'broken-resource',
  run(ctx) {
    if (!document.fonts) return;
    const failed = new Set();
    // "X Fallback" faces (next/font, fontaine) point at local() system fonts that may not exist here.
    document.fonts.forEach((f) => { const fam = f.family.replace(/["']/g, ''); if (f.status === 'error' && !/fallback/i.test(fam)) failed.add(fam); });
    for (const family of failed) {
      ctx.report({ rule: 'broken-resource', el: document.body, message: 'Web font "' + family + '" failed to load; text falls back to a different font.', details: { font: family } });
    }
  },
});

// In-flow content that is still invisible after the page was scrolled through
// and animations finished: typically a scroll-reveal that never fires
// (IntersectionObserver threshold too high for tall sections on phones, or the
// reveal script delayed or broken, as with WordPress optimisation plugins).
// Reveal libraries hide with opacity (AOS, Framer Motion, GSAP) or with
// visibility (Elementor entrance animations, WOW.js, ScrollReveal).
const REVEAL_HIDDEN = '.elementor-invisible, .wow, [data-sr-id]';
RL.rule({
  id: 'invisible-content',
  run(ctx) {
    const reported = [];
    const vw = document.documentElement.clientWidth;
    for (const el of ctx.elements) {
      const s = RL.cs(el);
      if (s.position === 'absolute' || s.position === 'fixed' || s.display === 'none') continue;
      const hiddenByVisibility = s.visibility === 'hidden';
      if (!hiddenByVisibility && parseFloat(s.opacity) > 0.05) continue;
      if (reported.some((r) => r.contains(el))) continue;
      const p = RL.parentOf(el);
      if (hiddenByVisibility) {
        // Report the outermost hidden element only, and only when it takes up room on the page.
        if (p && p !== document.body && RL.cs(p).visibility === 'hidden') continue;
        if (el.closest('[aria-hidden="true"],[inert],details:not([open]),[role="menu"],[role="dialog"],[role="tabpanel"],[role="listbox"],[role="tooltip"],nav')) continue;
      } else if (p && p !== document.body && RL.effectiveOpacity(p) <= 0.05) continue; // report the outermost one only
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 20 || el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 16) continue;
      if (hiddenByVisibility) {
        const reveal = el.matches(REVEAL_HIDDEN);
        // Without a reveal class: only a large block that leaves a blank gap, with nothing inside made visible again.
        if (!reveal && (r.height < 120 || r.width < vw * 0.3 || text.length < 40)) continue;
        if (Array.from(el.querySelectorAll('*')).some((d) => RL.cs(d).visibility === 'visible' && d.getBoundingClientRect().width > 0)) continue;
      }
      if (RL.isIgnored(el, 'invisible-content')) continue;
      // stacked slides/tabs: a visible sibling occupies the same box
      const sib = p ? Array.from(p.children).find((c) => c !== el && parseFloat(RL.cs(c).opacity) > 0.5 && RL.cs(c).visibility !== 'hidden' && (() => { const i = RL.intersect(RL.rectOf(c), RL.rectOf(el)); return i && i.w * i.h > 0.5 * r.width * r.height; })()) : null;
      if (sib) continue;
      reported.push(el);
      if (hiddenByVisibility) {
        const elementor = el.classList.contains('elementor-invisible');
        ctx.report({ rule: 'invisible-content', el, message: 'Content stays invisible (visibility: hidden' + (elementor ? ', class elementor-invisible' : '') + ') even after scrolling through the page, leaving a blank gap — ' +
          (elementor ? 'its Elementor entrance animation never ran (Elementor\'s script delayed or deferred by an optimisation plugin, a JavaScript error, or an animation the element doesn\'t support)?' : 'a reveal animation that never triggers?'), details: { visibility: 'hidden', elementor } });
      } else {
        ctx.report({ rule: 'invisible-content', el, message: 'Content stays invisible (opacity: ' + s.opacity + ') even after scrolling through the page — a reveal animation that never triggers?', details: { opacity: s.opacity } });
      }
    }
  },
});
