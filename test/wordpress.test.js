// WordPress and Elementor: mapping findings to widgets, finding the local site, and what the crawler skips.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, formatPretty } from '../src/index.js';
import { detectWordPress, looksLikeWordPress } from '../src/detect.js';
import { launchBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser.close(); });

const run = (target, config = {}) => check({
  targets: [target], browser, scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [375], colorSchemes: ['light'], sweep: false, stress: false, ...config },
});
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector}`).join('\n');

test('Elementor atomic (v4) elements: data-id and data-e-type without .elementor-element', async () => {
  const res = await run(join(here, 'fixtures/elementor-atomic/index.html'), { viewports: [1280] });
  const overflow = res.issues.find((i) => i.rule === 'text-overflow');
  assert.ok(overflow, dump(res));
  assert.deepEqual({ ...overflow.source.elementor, edit: undefined }, { id: 'a1b2c3d4', type: 'e-heading', doc: 12, docType: 'page', edit: undefined });
  assert.match(formatPretty(res), /in Elementor e-heading a1b2c3d4 in page #12/);
});

test('Elementor findings name the widget, its page and the editor link', async () => {
  const res = await run(join(here, 'fixtures/defects/elementor.html'));
  const overflow = res.issues.find((i) => i.rule === 'text-overflow');
  assert.ok(overflow, dump(res));
  assert.deepEqual({ ...overflow.source.elementor, edit: undefined }, { id: '99731bd', type: 'heading', doc: 12, docType: 'page', edit: undefined });
  assert.match(overflow.source.elementor.edit, /\/wp-admin\/post\.php\?post=12&action=elementor$/);
  const hidden = res.issues.find((i) => i.rule === 'invisible-content');
  assert.equal(hidden && hidden.source.elementor.type, 'container', dump(res));
  const text = formatPretty(res);
  assert.match(text, /in Elementor heading 99731bd in page #12 — edit: http/);
  assert.match(text, /In Elementor:.*Mobile\/Tablet view/);
});

test('detects WordPress themes, plugins and sites, and where the local site runs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-wp-'));
  try {
    const theme = join(dir, 'harbor');
    mkdirSync(theme);
    writeFileSync(join(theme, 'style.css'), '/*\nTheme Name: Harbor\nVersion: 1.0\n*/\nbody{}');
    writeFileSync(join(theme, '.wp-env.json'), '{ "port": 8899, "themes": ["."] }');
    let wp = detectWordPress(theme);
    assert.equal(wp.kind, 'theme');
    assert.equal(wp.name, 'Harbor');
    assert.equal(wp.urls[0], 'http://localhost:8899');
    assert.equal(wp.devCommand, 'npx wp-env start');

    const plugin = join(dir, 'booking');
    mkdirSync(plugin);
    writeFileSync(join(plugin, 'booking.php'), '<?php\n/**\n * Plugin Name: Booking Widgets\n */\n');
    writeFileSync(join(plugin, 'docker-compose.yml'), 'services:\n  wp:\n    image: wordpress:latest\n    ports:\n      - "8085:80"\n');
    wp = detectWordPress(plugin);
    assert.equal(wp.kind, 'plugin');
    assert.equal(wp.urls[0], 'http://localhost:8085');

    const site = join(dir, 'site');
    mkdirSync(join(site, 'wp-content'), { recursive: true });
    writeFileSync(join(site, 'wp-config.php'), "<?php\ndefine( 'WP_HOME', 'https://harbor.test/' );\n");
    mkdirSync(join(site, '.ddev'));
    writeFileSync(join(site, '.ddev/config.yaml'), 'name: harbor\ntype: wordpress\n');
    wp = detectWordPress(site);
    assert.equal(wp.kind, 'site');
    assert.deepEqual(wp.urls.slice(0, 2), ['https://harbor.test', 'https://harbor.ddev.site']);

    assert.equal(detectWordPress(join(here, 'fixtures')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('recognizes a WordPress response', () => {
  assert.ok(looksLikeWordPress({ status: 200, headers: { link: '<http://localhost:8888/wp-json/>; rel="https://api.w.org/"' }, body: '' }));
  assert.ok(looksLikeWordPress({ status: 200, headers: {}, body: '<link rel="stylesheet" href="/wp-content/themes/x/style.css">' }));
  assert.ok(!looksLikeWordPress({ status: 200, headers: {}, body: '<div id="root"></div>' }));
  assert.ok(!looksLikeWordPress(null));
});

test('crawling WordPress skips admin, login, feeds, REST and side-effect links, and samples archives', async () => {
  const res = await run(join(here, 'fixtures/wordpress-site/index.html'), { crawl: true, maxPages: 20 });
  const paths = res.pages.map((p) => p.path).sort();
  assert.deepEqual(paths, ['/about/', '/category/a/', '/category/b/', '/index.html'].sort(), JSON.stringify(paths));
});
