// Baseline: adopt renderlint on an app that already has findings. `renderlint baseline`
// records today's findings in renderlint-baseline.json (commit it); later runs fail only
// on findings that aren't in it, and say when baselined ones have been fixed.
// Progress: every run is compared with the previous one ("3 fixed, 1 new since the last run").
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

export const BASELINE_FILE = 'renderlint-baseline.json';

// What identifies a finding across runs: the rule, the element (or source line) and its text.
// Measurements, positions and list indexes change with every layout tweak, so they're left out.
const HASHED = /\.(?:css|sc|jsx|svelte|astro|emotion|tw)-[\w-]+|(?:__|_)[a-zA-Z0-9]{5,}(?=[.\s>:[]|$)/g;
export function findingKey(i) {
  const where = i.file ? i.file.replace(/\\/g, '/') + ':' + (i.line || '') :
    String(i.selector || '').replace(/:nth-(?:of-type|child)\(\d+\)/g, '').replace(HASHED, '').replace(/\s+/g, ' ').trim();
  const text = String(i.text || '').toLowerCase().replace(/\d+(?:[.,]\d+)*/g, '#').replace(/\s+/g, ' ').trim().slice(0, 40);
  return [i.rule, (i.role ? '[' + i.role + '] ' : '') + where, text].join(' | ');
}

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

export function writeBaseline(path, issues) {
  const seen = new Map();
  for (const i of issues) {
    const key = findingKey(i);
    if (!seen.has(key)) seen.set(key, { key, rule: i.rule, severity: i.severity, ...(i.file ? { file: i.file, line: i.line } : { selector: i.selector }), ...(i.text ? { text: String(i.text).slice(0, 60) } : {}), pages: (i.pages || []).slice(0, 5) });
  }
  const findings = Array.from(seen.values()).sort((a, b) => a.key.localeCompare(b.key));
  writeFileSync(path, JSON.stringify({ about: 'Findings renderlint accepted when this file was written. Runs fail only on findings not listed here. Rewrite it with `npx renderlint baseline`.', created: new Date().toISOString().slice(0, 10), findings }, null, 2) + '\n');
  return findings.length;
}

// Marks known findings, and returns what the summary line needs.
export function applyBaseline(issues, baseline, checkedPages) {
  const current = new Set();
  let known = 0;
  for (const i of issues) {
    const key = findingKey(i);
    current.add(key);
    if (baseline.keys.has(key)) { i.known = true; known += i.count || 1; }
  }
  const checked = new Set(checkedPages);
  // A baselined finding counts as fixed only if a page it was on was checked this time (or it was a source finding).
  const fixed = Array.from(baseline.keys.values()).filter((f) => !current.has(f.key) && (f.file || !(f.pages || []).length || f.pages.some((p) => checked.has(p)))).length;
  return { known, fixed, file: baseline.path };
}

// Compares with the previous run, then remembers this one. Pages not checked this time keep their findings.
export function trackProgress(outputDir, issues, checkedPages) {
  const path = join(outputDir, 'last-run.json');
  let prev = null;
  try { prev = JSON.parse(readFileSync(path, 'utf8')); } catch { /* first run */ }
  const checked = new Set(checkedPages);
  const now = new Map();
  for (const i of issues) {
    const key = findingKey(i);
    if (!now.has(key)) now.set(key, { pages: i.pages || [], source: !!i.file, severity: i.severity });
  }
  let progress = null;
  if (prev && prev.findings) {
    const before = new Map(Object.entries(prev.findings));
    const wasChecked = (f) => f.source || !f.pages.length || f.pages.some((p) => checked.has(p));
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
