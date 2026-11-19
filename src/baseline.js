// Baseline: adopt renderlint on an app that already has findings. `renderlint baseline`
// records today's findings in renderlint-baseline.json (commit it); later runs fail only
// on findings that aren't in it, and say when baselined ones have been fixed.
// Progress: every run is compared with the previous one ("3 fixed, 1 new since the last run").
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

export const BASELINE_FILE = 'renderlint-baseline.json';

// What identifies a finding across runs: the rule, the element (or source file) and its text.
// Measurements, positions, list indexes and line numbers change with every edit, so they're left out.
// Generated class names: CSS-in-JS prefixes (css-1q2w3e, sc-AbCd, svelte-xyz) and CSS modules
// (Card_root__a1B2c → Card_root). BEM elements (card__title) are real names and are kept.
const GENERATED = /\.(?:css|sc|jsx|svelte|astro|emotion|tw)-[\w-]+|(\.[A-Za-z][A-Za-z0-9-]*_[A-Za-z0-9-]+)__[A-Za-z0-9_-]{5,}(?=[.\s>:[#]|$)/g;
const norm = (t, n) => String(t || '').toLowerCase().replace(/\d+(?:[.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim().slice(0, n);
const PAGE_LEVEL = /^(?:html|body|:root)$/;
export function findingKey(i) {
  let where, text;
  if (i.file) { where = i.file.replace(/\\/g, '/'); text = norm(i.text, 40); }
  else {
    where = String(i.selector || '').replace(/:nth-(?:of-type|child)\(\d+\)/g, '').replace(GENERATED, '$1').replace(/\s+/g, ' ').trim();
    text = PAGE_LEVEL.test(where) ? '' : norm(i.text, 40); // a page-level finding's "text" is the page's copy
  }
  if (!where && !text) text = norm(i.message, 80); // console errors and the like: the message is all there is
  const dark = i.schemes && i.schemes.length === 1 && i.schemes[0] === 'dark' ? ' (dark)' : '';
  return [i.rule + dark, (i.role ? '[' + i.role + '] ' : '') + where, text].join(' | ');
}

// Keys for a list of findings: a key seen again (the same emoji twice in one file) gets #2, #3…
export function findingKeys(issues) {
  const seen = new Map();
  return issues.map((i) => { const k = findingKey(i); const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n > 1 ? k + ' #' + n : k; });
}

// "Could not load this page" is never accepted: a baselined broken page would stay silent.
const NEVER = new Set(['page-error']);

export function baselinePath(config, cwd) {
  if (config.baseline === false) return null;
  return resolve(cwd, typeof config.baseline === 'string' ? config.baseline : BASELINE_FILE);
}

export function readBaseline(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const b = JSON.parse(readFileSync(path, 'utf8'));
    return { path, keys: new Map((b.findings || []).map((f) => [f.key, f])) };
  } catch (e) { throw new Error(`renderlint: can't read ${path}: ${e.message}`); }
}

// keep: entries of an earlier baseline for pages (and source files) this run didn't check
export function writeBaseline(path, issues, { checkedPages, sourceScan = true } = {}) {
  const seen = new Map();
  const keys = findingKeys(issues);
  issues.forEach((i, n) => {
    if (NEVER.has(i.rule) || seen.has(keys[n])) return;
    seen.set(keys[n], { key: keys[n], rule: i.rule, severity: i.severity, ...(i.file ? { file: i.file, line: i.line } : { selector: i.selector }), ...(i.text ? { text: String(i.text).slice(0, 60) } : {}), pages: (i.pages || []).slice(0, 5) });
  });
  let kept = 0;
  const old = checkedPages ? readBaseline(path) : null;
  if (old) {
    const checked = new Set(checkedPages);
    for (const f of old.keys.values()) {
      const notChecked = f.file ? !sourceScan : (f.pages || []).length > 0 && !f.pages.some((p) => checked.has(p));
      if (notChecked && !seen.has(f.key)) { seen.set(f.key, f); kept++; }
    }
  }
  const findings = Array.from(seen.values()).sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(path, JSON.stringify({ about: 'Findings renderlint accepted when this file was written. Runs fail only on findings not listed here. Rewrite it with `npx renderlint baseline`.', created: new Date().toISOString().slice(0, 10), findings }, null, 2) + '\n');
  return { count: findings.length, kept };
}

// Marks known findings, and returns what the summary line needs.
export function applyBaseline(issues, baseline, checkedPages, { sourceScan = true } = {}) {
  const keys = findingKeys(issues);
  const current = new Set(keys);
  let known = 0;
  issues.forEach((i, n) => { if (!NEVER.has(i.rule) && baseline.keys.has(keys[n])) { i.known = true; known += i.count || 1; } });
  const checked = new Set(checkedPages);
  // A baselined finding counts as fixed only if this run looked where it was: one of its pages, or the source.
  const fixed = Array.from(baseline.keys.values()).filter((f) => !current.has(f.key) && (f.file ? sourceScan : !(f.pages || []).length || f.pages.some((p) => checked.has(p)))).length;
  return { known, fixed, file: baseline.path };
}

// Compares with the previous run, then remembers this one. Pages not checked this time keep their findings.
export function trackProgress(outputDir, issues, checkedPages, { sourceScan = true } = {}) {
  const path = join(outputDir, 'last-run.json');
  let prev = null;
  try { prev = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first run */ }
  const checked = new Set(checkedPages);
  const now = new Map();
  findingKeys(issues).forEach((key, n) => { const i = issues[n]; if (!now.has(key)) now.set(key, { pages: i.pages || [], source: !!i.file, severity: i.severity }); });
  let progress = null;
  if (prev && prev.findings) {
    const before = new Map(Object.entries(prev.findings));
    const wasChecked = (f) => (f.source ? sourceScan : !f.pages.length || f.pages.some((p) => checked.has(p)));
    const fixed = Array.from(before).filter(([k, f]) => !now.has(k) && wasChecked(f));
    const added = Array.from(now.keys()).filter((k) => !before.has(k));
    progress = { fixed: fixed.length, fixedErrors: fixed.filter(([, f]) => f.severity === 'error').length, new: added.length,
      newErrors: added.filter((k) => now.get(k).severity === 'error').length };
    for (const [k, f] of before) if (!now.has(k) && !wasChecked(f)) now.set(k, f); // not checked now: still there as far as we know
  }
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path, JSON.stringify({ findings: Object.fromEntries(now) }));
  return progress;
}

export function relPath(p, cwd) { return relative(cwd, p) || p; }
