// Launches a Chromium browser, trying (in order): Playwright's bundled
// Chromium, an installed Chrome/Edge, any cached Playwright Chromium, and
// finally installing Chromium on demand.
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

export async function launchBrowser({ log = () => {}, executablePath } = {}) {
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
