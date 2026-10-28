// End-to-end check against a real WordPress + Elementor site in Docker:
//   npm run test:wordpress            (RL_WP_PORT=8099 by default; containers are left running)
//   docker compose -p renderlint-wp -f e2e/wordpress/docker-compose.yml down -v   to clean up
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { check } from '../../src/index.js';
import { probe } from '../../src/server.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = process.env.RL_WP_PORT || '8099';
const site = `http://localhost:${port}`;
const compose = (...args) => execFileSync('docker', ['compose', '-p', 'renderlint-wp', '-f', join(here, 'docker-compose.yml'), ...args], { encoding: 'utf8', env: { ...process.env, RL_WP_PORT: port }, stdio: ['ignore', 'pipe', 'inherit'] });
const wp = (...args) => compose('run', '--rm', 'cli', ...args);

compose('up', '-d', 'db', 'wordpress');
for (let i = 0; ; i++) {
  const r = await probe(site);
  if (r && r.status < 500) break;
  if (i > 60) throw new Error(`WordPress did not come up at ${site}`);
  await new Promise((r) => setTimeout(r, 2000));
}
try { wp('core', 'is-installed'); } catch {
  wp('core', 'install', `--url=${site}`, '--title=Northwind Studio', '--admin_user=admin', '--admin_password=admin', '--admin_email=admin@example.com', '--skip-email');
}
wp('plugin', 'install', 'elementor', '--activate');
wp('theme', 'install', 'hello-elementor', '--activate');
wp('rewrite', 'structure', '/%postname%/');
console.log(wp('eval-file', '/scripts/pages.php').trim());

const run = (pages, config = {}) => check({ targets: pages.map((p) => site + p), scan: false, configFile: false, cwd: here,
  config: { crawl: false, screenshots: false, outputDir: join(here, '.renderlint'), ...config } });
const rules = (res, sev) => Array.from(new Set(res.issues.filter((i) => i.severity === sev).map((i) => i.rule))).sort();
const dump = (res) => res.issues.map((i) => `${i.severity} ${i.rule}: ${i.message} @ ${i.selector}`).join('\n');

const clean = await run(['/studio/']);
assert.equal(clean.stats.errors, 0, 'well-built Elementor page:\n' + dump(clean));

const broken = await run(['/beratung/']);
assert.deepEqual(rules(broken, 'error'), ['contrast', 'emoji', 'image-distortion', 'invisible-content', 'text-overflow', 'text-overlap', 'viewport-overflow'], dump(broken));
assert.ok(broken.issues.filter((i) => i.selector && i.rule !== 'invisible-content').every((i) => !i.source || i.source.elementor), 'findings map to Elementor widgets:\n' + dump(broken));
const texts = broken.issues.filter((i) => i.rule === 'placeholder-text').map((i) => i.text);
assert.ok(texts.some((t) => /Add Your Heading Text Here/.test(t)) && texts.some((t) => /Cool Number/.test(t)), dump(broken));

const crawl = await run(['/'], { crawl: true, maxPages: 20, sweep: false, stress: false });
const paths = crawl.pages.map((p) => p.path);
assert.ok(!paths.some((p) => /wp-admin|wp-login|feed|replytocom|wp-json/.test(p)), paths.join(', '));

// Logged-in pages: wp-admin sends anonymous visitors to wp-login.php; the default login selectors fit its form.
const anon = await run(['/wp-admin/profile.php'], { sweep: false, stress: false });
assert.ok(anon.issues.some((i) => i.rule === 'auth-required' && /wp-login\.php/.test(i.message)), dump(anon));
const signedIn = await run(['/studio/', '/wp-admin/profile.php'], { sweep: false, stress: false, rules: { 'console-error': 'off' }, auth: { login: '/wp-login.php', user: 'admin', password: 'admin' } });
assert.ok(!signedIn.issues.some((i) => i.rule === 'auth-required'), dump(signedIn));
assert.equal(signedIn.issues.filter((i) => i.pages.includes('/studio/') && i.severity === 'error').length, 0, 'admin toolbar is ignored:\n' + dump(signedIn));

console.log(`WordPress e2e passed: /studio/ clean, /beratung/ ${broken.stats.errors} errors, crawled ${paths.join(' ')}`);
