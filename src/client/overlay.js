// Dev-time overlay. Bundled after the analyzer into dist/client.js.
// Usage (any bundler, dev only):  import('renderlint/client').then((m) => m.start());

const SEV_COLOR = { error: '#e11d48', warn: '#d97706' };
const DEFAULT_WARN = new Set(['missing-alt', 'dead-link', 'tap-target', 'font-size-min', 'unlabeled-control', 'button-text-wrap', 'line-length', 'focus-indicator', 'control-height-mismatch', 'icon-misaligned']);

let host, shadow, state = { open: false, issues: [], dismissed: false };

function severityOf(issue, rules) {
  if (rules && rules[issue.rule]) return rules[issue.rule];
  return issue.severity || (DEFAULT_WARN.has(issue.rule) ? 'warn' : 'error');
}

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}

function ensureHost() {
  if (host && host.isConnected) return;
  host = document.createElement('div');
  host.id = '__renderlint_overlay';
  host.setAttribute('data-renderlint-ignore', '');
  host.style.cssText = 'position:fixed;z-index:2147483647;right:12px;bottom:12px;';
  shadow = host.attachShadow({ mode: 'open' });
  document.documentElement.appendChild(host);
}

let highlight;
function showHighlight(rect) {
  hideHighlight();
  if (!rect) return;
  highlight = document.createElement('div');
  highlight.id = '__renderlint_highlight';
  highlight.style.cssText = `position:absolute;pointer-events:none;z-index:2147483646;left:${rect.x - 3}px;top:${rect.y - 3}px;width:${rect.w + 6}px;height:${rect.h + 6}px;border:2px solid #e11d48;border-radius:4px;box-shadow:0 0 0 9999px rgba(15,23,42,.15)`;
  document.documentElement.appendChild(highlight);
  window.scrollTo({ top: Math.max(0, rect.y - innerHeight / 3), behavior: 'smooth' });
}
function hideHighlight() { if (highlight) { highlight.remove(); highlight = null; } }

function render() {
  ensureHost();
  const issues = state.issues;
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errors;
  shadow.innerHTML = '';
  const style = el('style', {}, `
    :host{all:initial}
    *{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .pill{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;border:0;cursor:pointer;color:#fff;font-size:13px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.25)}
    .panel{width:min(440px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;background:#0f172a;color:#e2e8f0;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.4);margin-bottom:8px;font-size:12.5px;line-height:1.45}
    .head{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #1e293b;position:sticky;top:0;background:#0f172a}
    .item{padding:9px 12px;border-bottom:1px solid #1e293b;cursor:pointer}
    .item:hover{background:#1e293b}
    .rule{font-weight:700;margin-right:6px}
    .sel{color:#94a3b8;font-family:ui-monospace,monospace;font-size:11px;word-break:break-all;margin-top:2px}
    .x{background:none;border:0;color:#94a3b8;cursor:pointer;font-size:12px;padding:4px 6px}
  `);
  shadow.append(style);
  if (!issues.length || state.dismissed) return;
  if (state.open) {
    const list = el('div', { class: 'panel' },
      el('div', { class: 'head' }, el('strong', {}, `renderlint · ${errors} error(s), ${warns} warning(s)`),
        el('span', {}, el('button', { class: 'x', onclick: () => { state.open = false; hideHighlight(); render(); } }, 'collapse'),
          el('button', { class: 'x', onclick: () => { state.dismissed = true; hideHighlight(); render(); } }, 'hide'))),
      ...issues.map((i) => el('div', { class: 'item', onmouseenter: () => showHighlight(i.rect), onmouseleave: hideHighlight },
        el('div', {}, el('span', { class: 'rule', style: `color:${SEV_COLOR[i.severity]}` }, i.rule), i.message),
        i.selector ? el('div', { class: 'sel' }, i.selector + (i.source && i.source.file ? `  — ${i.source.file}${i.source.line ? ':' + i.source.line : ''}` : '')) : null)));
    shadow.append(list);
  }
  shadow.append(el('button', { class: 'pill', style: `background:${errors ? SEV_COLOR.error : SEV_COLOR.warn};margin-left:auto`, onclick: () => { state.open = !state.open; render(); } },
    `renderlint: ${errors} error${errors === 1 ? '' : 's'}${warns ? `, ${warns} warning${warns === 1 ? '' : 's'}` : ''}`));
}

export function analyze(options = {}) {
  const res = window.__renderlint.analyze({ noScroll: true, skipDomContrast: false, rules: options.rules, ignoreSelectors: options.ignoreSelectors });
  const issues = res.issues
    .map((i) => ({ ...i, severity: severityOf(i, options.rules) }))
    .filter((i) => i.severity !== 'off')
    .sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1));
  return { issues, meta: res.meta, viewport: innerWidth, url: location.pathname + location.search };
}

let timer, observer, lastKey = '';
export function start(options = {}, onReport) {
  if (typeof window === 'undefined' || window.__renderlintClientStarted) return;
  window.__renderlintClientStarted = true;
  const run = () => {
    if (document.hidden) return;
    let report;
    try { report = analyze(options); } catch (e) { console.warn('[renderlint]', e); return; }
    state.issues = report.issues;
    if (options.overlay !== false) render();
    const key = JSON.stringify(report.issues.map((i) => i.rule + i.selector + i.message));
    if (key !== lastKey) {
      lastKey = key;
      if (onReport) onReport(report);
      if (options.console !== false && report.issues.length) {
        console.groupCollapsed(`%crenderlint: ${report.issues.filter((i) => i.severity === 'error').length} error(s), ${report.issues.filter((i) => i.severity !== 'error').length} warning(s)`, 'color:#e11d48;font-weight:bold');
        for (const i of report.issues) console.log(`[${i.severity}] ${i.rule}: ${i.message}\n  at ${i.selector}`);
        console.groupEnd();
      }
    }
  };
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(() => requestIdleCallback ? requestIdleCallback(run, { timeout: 2000 }) : run(), ms); };
  const boot = () => {
    schedule(options.delay || 1200);
    observer = new MutationObserver((muts) => {
      const ours = (n) => n && n.nodeType === 1 && (n.id || '').startsWith('__renderlint');
      if (muts.every((m) => ours(m.target) || Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).some(ours))) return;
      schedule(1500);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    addEventListener('resize', () => schedule(600));
  };
  if (document.readyState === 'complete') boot(); else addEventListener('load', boot, { once: true });
  return { run, stop() { observer && observer.disconnect(); clearTimeout(timer); host && host.remove(); window.__renderlintClientStarted = false; } };
}

export default start;
