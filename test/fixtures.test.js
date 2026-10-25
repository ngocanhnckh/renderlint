// Each defect fixture declares the rules it must trigger:
//   <meta name="expect" content="rule-a,rule-b">
// Error-level findings must match exactly (no false positives), and clean
// fixtures must produce zero errors.
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

for (const f of readdirSync(join(here, 'fixtures/defects')).filter((f) => f.endsWith('.html'))) {
  const file = join(here, 'fixtures/defects', f);
  const expected = (/<meta name="expect" content="([^"]*)"/.exec(readFileSync(file, 'utf8')) || [])[1].split(',').filter(Boolean).sort();
  test(`defect: ${f} → ${expected.join(', ')}`, async () => {
    const res = await check(opts(file));
    const errors = Array.from(new Set(res.issues.filter((i) => i.severity === 'error').map((i) => i.rule))).sort();
    assert.deepEqual(errors, expected, res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector}`).join('\n'));
  });
}

for (const f of readdirSync(join(here, 'fixtures/clean')).filter((f) => f.endsWith('.html'))) {
  test(`clean: ${f} has no errors`, async () => {
    const res = await check(opts(join(here, 'fixtures/clean', f), { colorSchemes: ['light', 'dark'] }));
    const errors = res.issues.filter((i) => i.severity === 'error');
    assert.equal(errors.length, 0, errors.map((i) => `${i.rule}: ${i.message} @ ${i.selector} [${i.viewports}]`).join('\n'));
  });
}
