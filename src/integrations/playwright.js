// Playwright Test integration: renderlint checks the pages your e2e tests reach, signed in as
// whatever role each test uses, in the state the test left them (dialogs open, step 2 of a wizard).
//
//   // tests/fixtures.ts
//   import { test as base } from '@playwright/test';
//   import { withRenderlint } from 'renderlint/playwright';
//   export const test = withRenderlint(base);          // options: see DEFAULT_OPTIONS
//
//   // playwright.config.ts: one report for the whole run (and a failed run on errors)
//   reporter: [['list'], ['renderlint/playwright/reporter']],
//
//   // in a test, to check a state mid-test as well:
//   test('…', async ({ page, renderlint }) => { …; await renderlint('review dialog'); … });
//
// Or without the fixture: import { renderlint } from 'renderlint/playwright'; await renderlint(page, 'name').
//
// Two kinds of check:
//   in place  the test's own page, as it is (all viewports by resizing it, dark mode by emulation,
//             stress and sweep). Done at the end of every passing test ("end"), and on request.
//   replay    each URL a test navigated to is opened again in fresh contexts with the test's
//             cookies, storage and the API responses it received, then checked like the CLI does
//             (real viewport contexts, touch on phones, data stress). Pages that land anywhere else
//             (in-memory state, role guards) are skipped. Done at the end of each worker ("visits").
// Identical states and URLs are checked once per run, across workers.
//
// This module never imports @playwright/test: it extends the `test` you pass, so it always
// uses your project's copy.
import { appendFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { checkLive, liveConfig, stateKey } from '../live.js';
import { runChecks, normalizeUrl, READY_INIT } from '../runner.js';
import { sessionStorageScript } from '../auth.js';

export const DEFAULT_OPTIONS = {
  auto: 'visits',      // 'visits': end-of-test check + replay of every visited URL | 'end': end-of-test check only | false: only explicit calls
  role: undefined,     // name for the signed-in user in the report and for de-duplication; default: the project name
  failTests: false,    // also fail the test itself when its checks find errors (the reporter fails the run either way)
  checkFailed: false,  // check the end state of tests that failed too
  replayMocks: true,   // replays get the JSON responses the test received (true), or call the server again (false)
  // any renderlint config key: viewports, rules, ignore, stress, sweep, colorSchemes, outputDir…
};

// Each run writes to its own folder, named after the runner process (the workers' parent),
// which the reporter (running in that process) merges at the end.
export function runDir(outputDir, runnerPid = process.ppid) { return join(outputDir, 'playwright', 'run-' + runnerPid); }

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);

// Claims key for this run, across workers: true for the first caller only.
function claim(dir, key) {
  mkdirSync(join(dir, 'claims'), { recursive: true });
  try { closeSync(openSync(join(dir, 'claims', hash(key)), 'wx')); return true; } catch { return false; }
}

function record(dir, entry) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `worker-${process.pid}.jsonl`), JSON.stringify(entry) + '\n');
}

let baseConfig;
async function configFor(options) {
  if (!baseConfig) baseConfig = loadConfig(process.cwd()).then((r) => r.config);
  const { auto, role, failTests, checkFailed, replayMocks, ...rest } = options || {};
  return liveConfig({ concurrency: 2, ...rest }, await baseConfig);
}

const marked = new Set(); // per worker: findings already drawn on a screenshot

// Check `page` in place, now. Records the findings for the reporter and returns them (raw).
export async function renderlint(page, name, options = {}) {
  if (typeof name === 'object' && name) { options = name; name = undefined; }
  const config = await configFor(options);
  const dir = runDir(config.outputDir);
  const key = await stateKey(page);
  if (key && !claim(dir, 'state|' + (options.role || '') + '|' + key)) return [];
  const t0 = Date.now();
  const role = options.role;
  const issues = await checkLive(page, { config, name: [role, name].filter(Boolean).join(': ') || undefined, marked });
  record(dir, { kind: 'live', url: page.url(), name: name || null, role: role || null, test: options.test || null, viewports: config.viewports.map((v) => v.width), ms: Date.now() - t0, issues });
  return issues;
}

export function withRenderlint(base, defaults = {}) {
  const defaultOptions = { ...DEFAULT_OPTIONS, ...defaults };
  return base.extend({
    renderlintOptions: [defaultOptions, { option: true }],

    // Per worker: the URLs to replay once the worker's tests are done.
    _renderlintReplays: [async ({ browser }, use) => {
      const queue = [];
      await use(queue);
      if (queue.length) await replay(browser, queue);
    }, { scope: 'worker', timeout: 15 * 60 * 1000 }],

    page: async ({ page, renderlintOptions, _renderlintReplays }, use, testInfo) => {
      const opts = { ...DEFAULT_OPTIONS, ...renderlintOptions };
      const visits = [];
      const responses = new Map();
      const pending = new Set();
      if (opts.auto) {
        await page.context().addInitScript(READY_INIT).catch(() => {});
        page.on('framenavigated', (f) => {
          if (f !== page.mainFrame() || !/^https?:/.test(f.url())) return;
          const k = normalizeUrl(f.url());
          if (!visits.some((v) => v.key === k)) visits.push({ key: k, url: f.url() });
        });
        if (opts.auto === 'visits' && opts.replayMocks !== false) {
          page.on('response', (r) => {
            const req = r.request();
            if (!/^(fetch|xhr)$/.test(req.resourceType()) || req.method() !== 'GET' || !/json/.test(r.headers()['content-type'] || '')) return;
            const p = r.json().then((json) => { responses.set(r.url(), { status: r.status(), json }); }).catch(() => {}).finally(() => pending.delete(p));
            pending.add(p);
          });
        }
      }
      await use(page);
      if (!opts.auto || page.isClosed()) return;
      if (testInfo.status !== testInfo.expectedStatus && !opts.checkFailed) return;
      const role = opts.role || testInfo.project.name || undefined;
      testInfo.setTimeout(testInfo.timeout + 120000);
      const issues = await renderlint(page, testInfo.title, { ...opts, role, test: testInfo.titlePath.slice(1).join(' › ') });
      const errors = issues.filter((i) => (i.severity || 'error') === 'error');
      if (issues.length) await testInfo.attach('renderlint.json', { body: JSON.stringify(issues.map(({ rect, related, ...i }) => i), null, 2), contentType: 'application/json' });
      if (opts.auto === 'visits' && visits.length) {
        await Promise.all(pending);
        const config = await configFor(opts);
        const dir = runDir(config.outputDir);
        const storageState = await page.context().storageState().catch(() => null);
        const session = await page.evaluate(() => Object.fromEntries(Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]))).catch(() => ({}));
        const origin = new URL(page.url()).origin;
        const ident = opts.role ? 'role:' + opts.role : 'state:' + hash(JSON.stringify([storageState && storageState.cookies.map((c) => c.name + '=' + c.value), storageState && storageState.origins, session]));
        for (const v of visits) {
          if (!claim(dir, ['visit', testInfo.project.name, ident, v.key].join('|'))) continue;
          _renderlintReplays.push({ url: v.url, role, opts, storageState, sessionStorage: Object.keys(session).length ? { [origin]: session } : {}, mocks: Object.fromEntries(responses) });
        }
      }
      if (opts.failTests && errors.length) {
        throw new Error(`renderlint: ${errors.length} UI defect(s) in the state this test left the page in:\n` + errors.slice(0, 10).map((i) => `  ${i.rule} @${i.viewport}px: ${i.message}${i.selector ? '\n      at ' + i.selector : ''}`).join('\n'));
      }
    },

    renderlint: async ({ page, renderlintOptions }, use, testInfo) => {
      const opts = { ...DEFAULT_OPTIONS, ...renderlintOptions };
      const role = opts.role || testInfo.project.name || undefined;
      await use((name, extra = {}) => renderlint(extra.page || page, name, { ...opts, ...extra, role, test: testInfo.titlePath.slice(1).join(' › ') }));
    },
  });
}

// Replays visited URLs in fresh contexts, grouped by signed-in state, with the same checks as the CLI.
async function replay(browser, queue) {
  const groups = new Map();
  for (const q of queue) {
    const k = hash(JSON.stringify([q.role, q.storageState, q.sessionStorage]));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(q);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const config = await configFor({ ...first.opts, crawl: false, auth: null });
    const mocks = {};
    for (const q of list) for (const [u, r] of Object.entries(q.mocks)) mocks[u] = r;
    // exact URLs first, so they win over the project's own mock patterns
    config.mock = { ...mocks, ...(config.mock || {}) };
    const session = { storageState: first.storageState || undefined, initScript: Object.keys(first.sessionStorage).length ? sessionStorageScript(first.sessionStorage) : null };
    const t0 = Date.now();
    let res;
    try {
      res = await runChecks(browser, { urls: list.map((q) => q.url), config, session, replay: true });
    } catch (e) {
      record(runDir(config.outputDir), { kind: 'replay-error', role: first.role, error: String(e && e.message || e) });
      continue;
    }
    const label = (p) => (first.role ? `${p} [${first.role}]` : p);
    record(runDir(config.outputDir), {
      kind: 'replay', role: first.role || null, viewports: config.viewports.map((v) => v.width), ms: Date.now() - t0,
      pages: res.pages.map((p) => ({ path: label(p.path), url: p.url, skipped: p.skipped || null, runs: p.runs.length })),
      issues: res.issues.map((i) => ({ ...i, page: label(i.page) })),
    });
  }
}
