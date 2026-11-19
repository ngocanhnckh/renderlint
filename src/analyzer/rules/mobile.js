// Mobile correctness: zoom, iPhone input zoom, the page language, and the iPhone
// notch and home indicator (safe areas).

function viewportMeta() {
  const m = document.querySelector('meta[name="viewport" i]');
  const out = {};
  if (!m) return null;
  for (const part of (m.getAttribute('content') || '').split(/[,;]/)) {
    const [k, v] = part.split('=').map((x) => (x || '').trim().toLowerCase());
    if (k) out[k] = v;
  }
  out.raw = m.getAttribute('content') || '';
  return out;
}
RL.viewportMeta = viewportMeta;

// WCAG 1.4.4: people must be able to zoom to 200%. Android browsers honour these
// settings; iOS Safari ignores user-scalable but still caps zooming into fields.
RL.rule({
  id: 'zoom-disabled',
  run(ctx) {
    const vm = viewportMeta();
    if (!vm || RL.isIgnored(document.body, 'zoom-disabled')) return;
    const noScale = vm['user-scalable'] === 'no' || vm['user-scalable'] === '0';
    const max = parseFloat(vm['maximum-scale']);
    const capped = Number.isFinite(max) && max < 2;
    if (!noScale && !capped) return;
    const what = noScale ? 'user-scalable=' + vm['user-scalable'] : 'maximum-scale=' + vm['maximum-scale'];
    ctx.report({
      rule: 'zoom-disabled', el: document.body,
      message: 'Pinch-zoom is ' + (noScale ? 'turned off' : 'capped at ' + max + '×') + ' (' + what + ' in <meta name="viewport">): people who need larger text can\'t zoom in on phones. ' +
        'If it was added to stop iPhones zooming into form fields, give the fields 16px text instead.',
      details: { content: vm.raw },
    });
  },
});

// iOS Safari zooms the page in when a field with text under 16px gets focus, and
// leaves it zoomed after the keyboard closes.
const TEXT_INPUT = /^(text|email|search|tel|url|password|number|date|datetime-local|month|time|week)$/;
RL.rule({
  id: 'input-zoom',
  run(ctx) {
    if (innerWidth >= 600) return; // phones only
    // A field the page never sized gets the browser's own default, which on iPhones is iOS's, not Chromium's:
    // only fields the page sized itself are judged.
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const uaSize = {};
    const defaultSize = (tag, type) => {
      const k = tag + '|' + (type || '');
      if (!(k in uaSize)) { const f = document.createElement(tag); if (type) f.type = type; root.appendChild(f); uaSize[k] = getComputedStyle(f).fontSize; }
      return uaSize[k];
    };
    let n = 0;
    for (const el of ctx.elements) {
      if (n >= 12) break;
      const tag = el.tagName;
      const field = (tag === 'INPUT' && TEXT_INPUT.test(el.type || 'text')) || tag === 'TEXTAREA' || tag === 'SELECT' ||
        (el.isContentEditable && !(el.parentElement && el.parentElement.isContentEditable));
      if (!field || el.disabled || el.readOnly || !RL.isVisible(el) || RL.isIgnored(el, 'input-zoom')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12) continue;
      const fs = parseFloat(RL.cs(el).fontSize) || 16;
      if (fs >= 15.5 || RL.cs(el).fontSize === defaultSize(tag.toLowerCase(), tag === 'INPUT' ? el.type : '')) continue;
      n++;
      ctx.report({
        rule: 'input-zoom', el,
        message: 'Tapping this ' + (tag === 'SELECT' ? 'menu' : 'field') + ' zooms the page in on iPhones: its text is ' + Math.round(fs * 10) / 10 + 'px, and Safari zooms into fields under 16px (and stays zoomed after typing).',
        details: { fontSize: fs },
      });
    }
    host.remove();
  },
});

// WCAG 3.1.1: screen readers pick the voice and pronunciation from <html lang>.
RL.rule({
  id: 'html-lang',
  run(ctx) {
    const lang = (document.documentElement.getAttribute('lang') || '').trim();
    if (lang || RL.isIgnored(document.body, 'html-lang')) return;
    ctx.report({
      rule: 'html-lang', el: document.body,
      message: '<html> has no lang attribute: screen readers can\'t tell which language to read the page in, and browsers can\'t offer translation or hyphenate correctly.',
    });
  },
});

// With viewport-fit=cover the page draws under an iPhone's status bar and notch
// and under its home indicator. The runner emulates those insets, then asks
// which text and controls are under them: at the top of the page (nothing
// scrolls above it) and in bars fixed to the bottom.
RL.safeAreaHits = function (insets) {
  const issues = [];
  const zones = [];
  if (insets.top) zones.push({ side: 'top', y0: 0, y1: insets.top });
  if (insets.bottom) zones.push({ side: 'bottom', y0: innerHeight - insets.bottom, y1: innerHeight });
  const items = RL.collectText().map((t) => ({ el: t.el, rects: t.vis, text: t.node }));
  for (const el of RL.allElements()) {
    if (!RL.isInteractive(el) || !RL.isVisible(el) || el.textContent.trim()) continue; // icon buttons: text is above
    items.push({ el, rects: [RL.rectOf(el)], text: null });
  }
  const seen = new Set();
  for (const z of zones) {
    for (const it of items) {
      if (RL.isIgnored(it.el, 'safe-area')) continue;
      const layer = RL.fixedAncestor(it.el);
      if (z.side === 'bottom' && !layer) continue; // page content scrolls up out of the home indicator's way
      const hit = it.rects.some((r) => {
        const top = r.y - scrollY, bottom = r.bottom - scrollY;
        return Math.min(bottom, z.y1) - Math.max(top, z.y0) >= Math.min(4, (bottom - top) / 2);
      });
      if (!hit) continue;
      const key = z.side + '|' + (layer ? RL.selector(layer) : RL.selector(RL.nearestBlock(it.el)));
      if (seen.has(key) || seen.size >= 6) continue;
      seen.add(key);
      const name = z.side === 'top' ? 'status bar and notch' : 'home indicator';
      issues.push({
        rule: 'safe-area', ...RL.issueBase(it.el, layer || undefined),
        message: (it.text ? '"' + RL.snippet(it.text, 30) + '"' : 'This control') + ' is under the iPhone ' + name +
          ': the page sets viewport-fit=cover, so it draws under them, but ' + (layer ? 'this ' + (z.side === 'top' ? 'header' : 'bar') : 'the top of the page') +
          ' doesn\'t make room with env(safe-area-inset-' + z.side + ').',
        details: { side: z.side, inset: z.side === 'top' ? insets.top : insets.bottom },
      });
    }
  }
  return issues;
};
