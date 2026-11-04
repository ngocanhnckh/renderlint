// --cdp: a Chromium that is already running (a shared headless Chrome), reached over CDP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { check } from '../src/index.js';
import { connectBrowser } from '../src/browser.js';

const here = dirname(fileURLToPath(import.meta.url));
const procs = [];

// A Chrome started the way a shared one is: scrollbars shown, none of renderlint's launch flags.
async function startChrome(extra = []) {
  const p = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', '--remote-debugging-port=0', '--no-first-run',
    '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'rl-cdp-')), ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  procs.push(p);
  const ws = await new Promise((resolve, reject) => {
    let buf = '';
    p.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
    p.once('exit', () => reject(new Error('chrome exited: ' + buf.slice(-500))));
  });
  return { proc: p, http: 'http://' + new URL(ws).host };
}
let shared, isolated;
before(async () => {
  shared = await startChrome();
  // can't reach this machine's loopback, like a Chrome in another container
  isolated = await startChrome(['--proxy-server=http://127.0.0.1:1', '--proxy-bypass-list=<-loopback>']);
});
after(() => { for (const p of procs) p.kill(); });

const run = (target, cdp) => check({
  targets: [target], scan: false, configFile: false, cwd: join(here, '.tmp'),
  config: { crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [375, 768], colorSchemes: ['light'], sweep: false, stress: false, ...(cdp ? { cdp } : {}) },
});
const key = (res) => res.issues.map((i) => `${i.severity} ${i.rule} ${i.selector || ''} ${(i.viewports || []).join('/')}`).sort();
const FILE = join(here, 'fixtures/defects/ai-landing-bugs.html');

test('the same findings as a browser renderlint launches; the browser stays up with no tabs left', async () => {
  const local = await run(FILE);
  const remote = await run(FILE, shared.http);
  assert.ok(local.issues.length > 3);
  assert.deepEqual(key(remote), key(local));
  assert.equal(shared.proc.exitCode, null, 'the shared browser was shut down');
  const pages = await (await fetch(shared.http + '/json/list')).json();
  assert.deepEqual(pages.filter((p) => p.type === 'page').map((p) => p.url), ['about:blank']);
});

test('scrollbars are hidden on every page, so a 768px viewport lays out at 768px', async () => {
  const b = await connectBrowser(shared.http);
  const c = await b.newContext({ viewport: { width: 768, height: 600 } });
  const p = await c.newPage();
  const width = async () => { await p.goto('data:text/html,<div style="height:3000px">tall</div>'); return p.evaluate(() => document.documentElement.clientWidth); };
  assert.equal(await width(), 768);
  await p.goto('about:blank');
  assert.equal(await width(), 768, 'after a navigation too');
  await b.close();
});

test("a browser that can't reach this machine: renderlint fetches the local site for it", async () => {
  const local = await run(FILE);
  const remote = await run(FILE, isolated.http);
  assert.ok(!remote.issues.some((i) => i.rule === 'page-error'), key(remote).join('\n'));
  assert.deepEqual(key(remote), key(local));
});

test('an endpoint nothing listens on: a clear error', async () => {
  await assert.rejects(run(join(here, 'fixtures/clean/ignored.html'), 'http://127.0.0.1:1'), /could not connect to the browser at http:\/\/127\.0\.0\.1:1 \(--cdp/);
});
