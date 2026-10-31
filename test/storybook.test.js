// renderlint storybook: every story from index.json, in its iframe (test/fixtures/storybook mimics
// Storybook 9's preview iframe; the real thing was checked against a Storybook 9.1 build).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check } from '../src/index.js';
import { launchBrowser } from '../src/browser.js';
import { storyUrl } from '../src/storybook.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.pages} ${i.viewports} ${i.selector || ''}`).join('\n');

test('every story is checked as a page of its own, named after the story', async () => {
  const res = await check({
    storybook: { target: join(here, 'fixtures/storybook') }, browser, configFile: false, cwd: here,
    config: { screenshots: false, outputDir: join(here, '.tmp'), viewports: [375, 1280], colorSchemes: ['light'], sweep: false, stress: false },
  });
  // docs entries and stories tagged skip-renderlint are left out
  assert.deepEqual(res.pages.map((p) => p.path).sort(), ['story: Badge / Long status', 'story: Badge / Short', 'story: List / Broken', 'story: Menu / Open', 'story: Pages / Pricing', 'story: Table / Wide'], JSON.stringify(res.pages));
  const on = (rule, story) => res.issues.filter((i) => i.rule === rule && i.pages.includes('story: ' + story));
  assert.equal(on('text-overflow', 'Badge / Long status').length, 1, dump(res));
  // a state the play function reaches (the open menu) is what gets checked
  assert.ok(on('contrast', 'Menu / Open').some((i) => /every session/.test(i.text)), dump(res));
  // page-level rules apply to fullscreen stories only: the pricing page breaks a phone, a wide table component alone on the canvas doesn't
  assert.ok(on('viewport-overflow', 'Pages / Pricing').length, dump(res));
  assert.equal(on('viewport-overflow', 'Table / Wide').length, 0, dump(res));
  // a story that throws is reported with its error
  assert.ok(on('page-error', 'List / Broken').some((i) => /failed to render: Cannot read properties of undefined/.test(i.message)), dump(res));
  assert.equal(res.issues.filter((i) => i.severity === 'error' && i.pages.includes('story: Badge / Short')).length, 0, dump(res));
});

test('globals (themes, locales) go in the iframe URL', () => {
  assert.equal(storyUrl('http://x', 'card--default', 'theme:dark;locale:de'), 'http://x/iframe.html?id=card--default&viewMode=story&globals=theme:dark;locale:de');
});
