// Each defect fixture declares the rules it must trigger:
//   <meta name="expect" content="rule-a,rule-b">
//   <meta name="expect-warn" content="rule-c">     (optional: warnings that must appear)
// Error-level findings must match exactly (no false positives), and clean
// fixtures must produce zero errors, and none of the warnings listed in
//   <meta name="no-warn" content="rule-c">
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const opts = (file, extra = {}) => ({
  targets: [file], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), ...extra },
});

function metaList(html, name) {
  const m = new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html);
  return m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
}

for (const f of readdirSync(join(here, 'fixtures/defects')).filter((f) => f.endsWith('.html'))) {
  const file = join(here, 'fixtures/defects', f);
  const html = readFileSync(file, 'utf8');
  const expected = metaList(html, 'expect').sort();
  const warns = metaList(html, 'expect-warn');
  test(`defect: ${f} → ${expected.concat(warns.map((w) => w + ' (warn)')).join(', ')}`, async () => {
    const res = await check(opts(file));
    const dump = res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector}`).join('\n');
    const errors = Array.from(new Set(res.issues.filter((i) => i.severity === 'error').map((i) => i.rule))).sort();
    assert.deepEqual(errors, expected, dump);
    for (const w of warns) assert.ok(res.issues.some((i) => i.rule === w), `expected warning ${w}\n${dump}`);
  });
}

for (const f of readdirSync(join(here, 'fixtures/clean')).filter((f) => f.endsWith('.html'))) {
  const noWarn = metaList(readFileSync(join(here, 'fixtures/clean', f), 'utf8'), 'no-warn');
  test(`clean: ${f} has no errors`, async () => {
    const res = await check(opts(join(here, 'fixtures/clean', f), { colorSchemes: ['light', 'dark'] }));
    const errors = res.issues.filter((i) => i.severity === 'error' || noWarn.includes(i.rule));
    assert.equal(errors.length, 0, errors.map((i) => `${i.rule}: ${i.message} @ ${i.selector} [${i.viewports}]`).join('\n'));
  });
}
