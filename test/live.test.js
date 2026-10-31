// Checking a page in the state a test left it in (src/live.js), and replaying a test's pages
// in fresh contexts (runChecks with a given session and replay: true).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from '../src/browser.js';
import { serveStatic } from '../src/server.js';
import { checkLive, liveConfig } from '../src/live.js';
import { runChecks } from '../src/runner.js';
import { normalize, DEFAULTS } from '../src/config.js';
import { sessionStorageScript } from '../src/auth.js';

const here = dirname(fileURLToPath(import.meta.url));
let browser, srv, authSrv;
before(async () => {
  browser = await launchBrowser();
  srv = await serveStatic(join(here, 'fixtures/harness'));
  authSrv = await serveStatic(join(here, 'fixtures/auth'), { spa: true });
});
after(async () => { await browser.close(); await srv.close(); await authSrv.close(); });

const dump = (issues) => issues.map((i) => `${i.severity} ${i.rule} @${i.viewport}: ${i.message} ${i.selector || ''}`).join('\n');

test('in place: a dialog opened by a click is checked at every width, and the page is left as it was', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  try {
    await page.goto(srv.url + '/dialog.html');
    await page.click('#open');
    await page.fill('textarea', 'Leave it at the door');
    await page.evaluate(() => window.scrollTo(0, 300));
    const before = await page.evaluate(() => ({ text: document.body.innerText, y: scrollY }));
    const config = liveConfig({ viewports: [375, 1280], screenshots: false, outputDir: join(here, '.tmp'), sweep: false });
    const issues = await checkLive(page, { config, name: 'new order dialog' });
    // the dialog's own defects: too-light hint everywhere, the fixed-width row only on a phone
    const hint = issues.filter((i) => i.rule === 'contrast' && /hint/.test(i.selector));
    assert.deepEqual(hint.map((i) => i.viewport).sort((a, b) => a - b), [375, 1280], dump(issues));
    const row = issues.filter((i) => /viewport-overflow|content-overflow/.test(i.rule));
    assert.ok(row.length && row.every((i) => i.viewport === 375 && /panel/.test(i.selector)), dump(issues));
    // nothing from the page behind the modal (dimmed by the backdrop on purpose)
    assert.ok(!issues.some((i) => /main/.test(i.selector || '') && !/panel/.test(i.selector || '')), dump(issues));
    assert.ok(issues.every((i) => i.page === '/dialog.html [new order dialog]'), dump(issues));
    // left as it was: size, scroll, text (no stressed copy), the value the test typed
    assert.deepEqual(page.viewportSize(), { width: 1280, height: 800 });
    const now = await page.evaluate(() => ({ text: document.body.innerText, y: scrollY }));
    assert.deepEqual(now, before);
    assert.equal(await page.inputValue('textarea'), 'Leave it at the door');
    // and the test can carry on
    await page.click('#place');
    assert.equal(await page.textContent('h1'), 'Order placed');
  } finally { await context.close(); }
});

test('replay: a test\'s pages re-opened with its storage and API responses; a page that lands elsewhere is skipped, not reported', async () => {
  const config = normalize({ ...DEFAULTS, crawl: false, screenshots: false, outputDir: join(here, '.tmp'), viewports: [1280], colorSchemes: ['light'], sweep: false, stress: false,
    mock: { [authSrv.url + '/api/me']: { json: { name: 'Dana' } }, [authSrv.url + '/api/reports']: { json: [{ title: 'Q3 revenue' }] } } });
  const origin = authSrv.url;
  const signedIn = { storageState: { cookies: [], origins: [] }, initScript: sessionStorageScript({ [origin]: { 'demo.token': 'from-the-test' } }) };
  const res = await runChecks(browser, { urls: [origin + '/dashboard', origin + '/reports'], config, session: signedIn, replay: true });
  assert.deepEqual(res.pages.map((p) => p.skipped || 'checked'), ['checked', 'checked'], JSON.stringify(res.pages));
  assert.ok(res.issues.some((i) => /badge/.test(i.selector || '') && i.page === '/dashboard'), dump(res.issues)); // the fixture's planted defect
  // without the token the guard sends the replay to /login: skipped with a note, no auth-required error
  const out = await runChecks(browser, { urls: [origin + '/dashboard'], config, session: { storageState: { cookies: [], origins: [] } }, replay: true });
  assert.match(out.pages[0].skipped || '', /landed on \/login/);
  assert.equal(out.issues.length, 0, dump(out.issues));
});
