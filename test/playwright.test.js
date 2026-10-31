// renderlint inside a real Playwright Test run: the fixture checks what the tests reach and the
// reporter merges it into one report for the run (test/playwright-e2e/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const freePort = () => new Promise((resolve) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

test('Playwright fixture + reporter: in-place checks, replays of visited pages, one report, a failed run', async () => {
  const out = mkdtempSync(join(here, '.tmp-pw-'));
  const cli = join(dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
  const port = process.env.RL_PW_PORT || await freePort();
  const r = spawnSync(process.execPath, [cli, 'test', '-c', join(here, 'playwright-e2e/playwright.config.mjs')], {
    cwd: join(here, '..'), env: { ...process.env, RL_PW_PORT: String(port), RL_PW_OUT: out, CI: '1' }, encoding: 'utf8', timeout: 240000,
  });
  const log = r.stdout + r.stderr;
  assert.match(log, /2 passed/, log); // the app's tests themselves pass…
  assert.equal(r.status, 1, log); // …but the run fails on renderlint's errors
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'));
  const modes = report.pages.map((p) => p.mode + ' ' + p.path).sort();
  assert.deepEqual(modes, [
    'in place /dashboard [sign in lands on the dashboard]',
    'in place /reports [reports list]', // the explicit mid-test check; the identical end state is not checked again
    'replay /dashboard', 'replay /login', 'replay /reports',
  ], JSON.stringify(report.pages, null, 1));
  // the badge on the signed-in dashboard, found in the test's page and in the replay (sessionStorage token + the route-mocked API)
  const badge = report.issues.find((i) => i.rule === 'text-overflow' && /badge/.test(i.selector));
  assert.ok(badge && badge.pages.includes('/dashboard') && badge.pages.includes('/dashboard [sign in lands on the dashboard]'), JSON.stringify(report.issues, null, 1));
  assert.equal(report.stats.errors, 1, JSON.stringify(report.issues, null, 1));
  rmSync(out, { recursive: true, force: true });
});
