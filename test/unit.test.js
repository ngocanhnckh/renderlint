import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSources } from '../src/scan.js';
import { normalize, DEFAULTS } from '../src/config.js';
import { mergeIssues } from '../src/report.js';
import { suggestColor, contrast } from '../src/color.js';
import { upsertSection, agentSection } from '../src/agent-instructions.js';
import { check } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

test('static scan finds emoji and honours ignore comments', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'App.jsx'), [
    'export default () => <h1>🚀 Launch</h1>;',
    '// comment with emoji 🎉 is fine',
    'const a = "✨"; // renderlint-ignore emoji',
    '// renderlint-ignore emoji -- chat demo',
    'const b = "👋";',
    'console.log("✅ done");',
    'const c = "★ ✓ © → ok";',
    'const d = "lorem ipsum dolor";',
  ].join('\n'));
  const issues = scanSources({ cwd: dir });
  assert.deepEqual(issues.map((i) => [i.rule, i.line]), [['emoji', 1], ['placeholder-text', 8]]);
});

test('config normalizes viewports and severities', () => {
  const c = normalize({ ...DEFAULTS, viewports: '1280,375x700', rules: { 'line-length': 0, contrast: 'warn' } });
  assert.deepEqual(c.viewports, [{ width: 375, height: 700 }, { width: 1280, height: 800 }]);
  assert.equal(c.rules['line-length'], 'off');
  assert.equal(c.rules.contrast, 'warn');
  assert.throws(() => normalize({ ...DEFAULTS, rules: { contrast: 'loud' } }));
});

test('similar findings in repeated cards are grouped', () => {
  const config = normalize({ ...DEFAULTS });
  const mk = (n, vp) => ({ rule: 'contrast', message: `Low text contrast: 3.${n}:1`, selector: `main > div.card:nth-of-type(${n}) > span`, page: '/', viewport: vp });
  const merged = mergeIssues([mk(1, 375), mk(2, 375), mk(3, 1280), mk(1, 1280)], config);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].count, 3);
  assert.deepEqual(merged[0].viewports.sort((a, b) => a - b), [375, 1280]);
});

test('contrast suggestion meets the target', () => {
  const s = suggestColor({ r: 255, g: 255, b: 255 }, { r: 34, g: 197, b: 94 }, 4.6);
  const hex = s.split(' ')[1];
  const c = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  const ratio = s.startsWith('text') ? contrast(c, { r: 34, g: 197, b: 94 }) : contrast({ r: 255, g: 255, b: 255 }, c);
  assert.ok(ratio >= 4.6, s + ' ' + ratio);
});

test('agent section upsert is idempotent', () => {
  const once = upsertSection('# Notes\n', agentSection());
  const twice = upsertSection(once, agentSection());
  assert.equal(once, twice);
  assert.ok(once.startsWith('# Notes'));
});

test('removing ignore directives makes intentional defects fire', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-'));
  const html = readFileSync(join(here, 'fixtures/clean/ignored.html'), 'utf8')
    .replace(/ data-renderlint-ignore(="[^"]*")?/g, '').replace('--renderlint-ignore: contrast', '');
  writeFileSync(join(dir, 'index.html'), html);
  const res = await check({ targets: [join(dir, 'index.html')], scan: false, configFile: false, cwd: dir, config: { crawl: false, screenshots: false, viewports: [375], outputDir: join(dir, '.out') } });
  const rules = Array.from(new Set(res.issues.filter((i) => i.severity === 'error').map((i) => i.rule))).sort();
  assert.deepEqual(rules, ['contrast', 'emoji', 'text-clipped']);
});
