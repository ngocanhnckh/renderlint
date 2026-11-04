// Launches a Chromium browser, trying (in order): Playwright's bundled
// Chromium, an installed Chrome/Edge, any cached Playwright Chromium, and
// finally installing Chromium on demand. With --cdp / RENDERLINT_CDP, connects
// to a running one instead.
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function cachedChromiums() {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright'),
    join(homedir(), 'Library', 'Caches', 'ms-playwright'), join(process.env.LOCALAPPDATA || '', 'ms-playwright')].filter(Boolean);
  const out = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const d of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const rel of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
        const p = join(root, d, rel);
        if (existsSync(p)) out.push(p);
      }
    }
  }
  return out;
}

function systemChromes() {
  const p = platform();
  const list = p === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : p === 'win32'
      ? [join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'), join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe')]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
  return list.filter((f) => existsSync(f));
}

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

// A browser that is already running (a shared headless Chrome, chromedp/headless-shell, Browserless),
// reached over CDP. renderlint opens its own contexts there and closes only those: the browser stays up.
// Launch flags never reach a running browser, so what they do is applied to each page instead.
export async function connectBrowser(endpoint, { log = () => {} } = {}) {
  const { chromium } = await import('playwright');
  let browser;
  try { browser = await chromium.connectOverCDP(endpoint, { timeout: 30000 }); } catch (e) {
    throw new Error(`renderlint could not connect to the browser at ${endpoint} (--cdp / RENDERLINT_CDP): ${String(e.message || e).split('\n')[0]}`);
  }
  const remote = { cdp: endpoint, proxyLoopback: false, contexts: new Set() };
  browser.__renderlint = remote;
  try {
    const s = await browser.newBrowserCDPSession();
    const { arguments: args = [] } = await s.send('Browser.getBrowserCommandLine');
    await s.detach().catch(() => {});
    if (args.some((a) => /swiftshader/i.test(a))) log('Warning: the browser at ' + endpoint + ' renders with SwiftShader (--use-angle=swiftshader), which can give false contrast findings. Start it without the --use-gl / --use-angle flags.');
  } catch { /* the command line is only available with --enable-automation */ }
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (opts) => {
    const ctx = await newContext(opts);
    remote.contexts.add(ctx);
    ctx.once('close', () => remote.contexts.delete(ctx));
    // The remote browser can't reach this machine's loopback (a server renderlint started): fetch it here.
    if (remote.proxyLoopback) {
      await ctx.route((u) => LOOPBACK.test(u.hostname), async (route) => {
        try { await route.fulfill({ response: await route.fetch({ maxRedirects: 0 }) }); } catch { await route.abort('connectionrefused').catch(() => {}); }
      });
      // Its websockets (a dev server's live reload) would fail and log errors: hold them, unconnected. Checking doesn't need them.
      await ctx.routeWebSocket((u) => LOOPBACK.test(u.hostname), () => {});
    }
    const newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => {
      const page = await newPage();
      // --hide-scrollbars: without it the 768px viewport lays out at 752px. The override lasts while the session is attached.
      try { const c = await ctx.newCDPSession(page); await c.send('Emulation.setScrollbarsHidden', { hidden: true }); } catch { /* best effort */ }
      return page;
    };
    return ctx;
  };
  const close = browser.close.bind(browser);
  browser.close = async () => {
    for (const c of Array.from(remote.contexts)) await c.close().catch(() => {});
    await close(); // a browser reached over CDP is disconnected from, not shut down
  };
  return browser;
}

// Over CDP: can the remote browser load the app at this loopback URL? If not, renderlint serves those requests itself.
export async function reachApp(browser, url, { log = () => {} } = {}) {
  const remote = browser && browser.__renderlint;
  if (!remote || remote.proxyLoopback || !LOOPBACK.test(new URL(url).hostname)) return;
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'commit', timeout: 10000 });
  } catch (e) {
    if (!/net::ERR_(CONNECTION_REFUSED|ADDRESS_UNREACHABLE|CONNECTION_FAILED|NAME_NOT_RESOLVED|PROXY_CONNECTION_FAILED|TIMED_OUT|CONNECTION_TIMED_OUT)|Timeout/i.test(String(e))) return;
    remote.proxyLoopback = true;
    log(`The browser at ${remote.cdp} can't reach ${new URL(url).origin}: renderlint fetches that site's requests for it.`);
  } finally { await ctx.close().catch(() => {}); }
}

export async function launchBrowser({ log = () => {}, executablePath, cdp } = {}) {
  const endpoint = cdp || process.env.RENDERLINT_CDP;
  if (endpoint) return connectBrowser(endpoint, { log });
  const { chromium } = await import('playwright');
  const args = ['--disable-dev-shm-usage', '--font-render-hinting=none', '--hide-scrollbars', '--disable-lcd-text'];
  const attempts = [];
  if (executablePath || process.env.RENDERLINT_CHROME) attempts.push(executablePath || process.env.RENDERLINT_CHROME);
  let bundled;
  try { bundled = chromium.executablePath(); } catch { /* ignore */ }
  if (bundled && existsSync(bundled)) attempts.push(undefined);
  attempts.push(...systemChromes(), ...cachedChromiums());
  let lastErr;
  for (const exe of attempts) {
    try {
      return await chromium.launch({ headless: true, executablePath: exe, args });
    } catch (e) { lastErr = e; }
  }
  log('No Chromium found — installing one with `npx playwright install chromium` (one-time)…');
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js'); // newer playwright doesn't export ./cli.js
  const r = spawnSync(process.execPath, [cli, 'install', 'chromium'], { stdio: 'inherit' });
  if (r.status === 0) return chromium.launch({ headless: true, args });
  throw new Error('renderlint could not launch Chromium. Run `npx playwright install chromium` or set RENDERLINT_CHROME=/path/to/chrome.\n' + (lastErr ? lastErr.message : ''));
}
