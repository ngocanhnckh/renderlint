import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from './rules-meta.js';
import { normalizeAuth } from './auth.js';

export const DEFAULTS = {
  url: undefined,          // base URL of a running app
  serve: undefined,        // command that starts a server (e.g. "npm run dev")
  dir: undefined,          // static directory to serve (e.g. "dist")
  base: undefined,         // public base path the build expects, e.g. "/my-repo/" (Vite `base`)
  pages: ['/'],            // entry pages (paths or absolute URLs)
  crawl: true,             // follow same-origin links from entry pages
  maxPages: 12,
  exclude: [],             // path globs to skip while crawling, e.g. "/blog/*"
  viewports: [375, 768, 1280],
  colorSchemes: 'auto',    // 'auto' (light + dark if the app has dark-mode CSS) | ['light'] | ['light','dark']
  rules: {},               // { "line-length": "off", "tap-target": "error" }
  ignore: [],              // [{ rule: "contrast", selector: ".legal" }]
  failOn: 'error',         // 'error' | 'warn' | 'never'
  screenshots: true,
  outputDir: '.renderlint',
  autoScroll: true,
  reducedMotion: true,
  stress: 1.5,             // re-check with 50% longer text, long unbreakable words and declared samples (fragile-layout); false to disable
  sweep: true,             // also check these widths between the main viewports (layout rules only); false to disable
  sweepBreakpoints: true,  // with sweep: true, also check both sides of every width breakpoint the page uses (CSS media queries, matchMedia)
  stressData: true,        // also reload pages that fetch JSON with longer API data; false to disable
  states: [],              // extra UI states to check: [{ name, page, click, hover, fill, press, waitFor, mock, run }]
  auth: null,              // signed-in pages: { login: '/login', user: '${RENDERLINT_USER}', password: '${RENDERLINT_PASSWORD}' } or { storage: { sessionStorage: { token: 'test' } } }
  mock: {},                // API responses to serve instead: { "**/api/orders*": "fixtures/orders.json" | { status, json } | data }
  mockFrom: [],            // API responses from the project's MSW handlers ("src/mocks/handlers.ts") or a HAR recording ("recordings/app.har")
  scan: true,              // static source scan (emoji, placeholder copy) in addition to rendering
  scanDirs: undefined,
  contrastLevel: 'AA',
  minTapTarget: 24,
  minFontSize: 12,
  maxLineLength: 120,
  concurrency: Math.min(6, Math.max(3, availableParallelism() >> 1)), // browser contexts (page × viewport × color scheme) checked in parallel
  dedupe: true,            // pages that render identically share the contrast/stress/sweep results; 'template' also skips stress/sweep on pages built like an earlier one; false: off
  timeout: 30000,
  serverTimeout: 120000,
  maxScreenshotHeight: 12000,
  waitFor: undefined,      // selector to wait for before checking
  delay: 0,                // extra ms to wait after load
};

export const SWEEP_WIDTHS = Object.freeze([320, 360, 414, 480, 600, 720, 900, 1024, 1100, 1366, 1440, 1536, 1920]);

const FILES = ['renderlint.config.js', 'renderlint.config.mjs', 'renderlint.config.cjs', 'renderlint.config.json', '.renderlintrc.json', '.renderlintrc'];

export async function loadConfig(cwd = process.cwd(), explicit) {
  let user = {};
  let file;
  if (explicit) file = resolve(cwd, explicit);
  else file = FILES.map((f) => join(cwd, f)).find((f) => existsSync(f));
  if (file) {
    if (/\.(c|m)?js$/.test(file)) {
      const mod = await import(pathToFileURL(file).href);
      user = mod.default || mod;
      if (typeof user === 'function') user = await user();
    } else {
      user = JSON.parse(readFileSync(file, 'utf8'));
    }
  } else if (existsSync(join(cwd, 'package.json'))) {
    try { user = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).renderlint || {}; } catch { /* ignore */ }
  }
  return { config: normalize({ ...DEFAULTS, ...user }, cwd), file };
}

export function normalize(c, cwd = process.cwd()) {
  const out = { ...c };
  out.viewports = (Array.isArray(c.viewports) ? c.viewports : String(c.viewports).split(',')).map((v) => {
    if (typeof v === 'object') return { width: +v.width, height: +(v.height || defaultHeight(+v.width)) };
    const [w, h] = String(v).trim().split('x').map(Number);
    return { width: w, height: h || defaultHeight(w) };
  }).filter((v) => v.width > 0).sort((a, b) => a.width - b.width);
  out.rules = { ...(c.rules || {}) };
  for (const [k, v] of Object.entries(out.rules)) {
    const sev = v === 0 || v === false ? 'off' : v === 1 ? 'warn' : v === 2 || v === true ? 'error' : String(v);
    if (!['off', 'warn', 'error'].includes(sev)) throw new Error(`renderlint: invalid severity "${v}" for rule "${k}" (use off | warn | error)`);
    if (!RULES[k]) console.warn(`renderlint: unknown rule "${k}" in config`);
    out.rules[k] = sev;
  }
  if (out.stress === true) out.stress = 1.5;
  if (typeof out.colorSchemes === 'string' && out.colorSchemes !== 'auto') out.colorSchemes = out.colorSchemes.split(',');
  if (typeof out.pages === 'string') out.pages = out.pages.split(',');
  out.outputDir = resolve(cwd, out.outputDir);
  if (!out.viewports.length || out.viewports.some((v) => !Number.isFinite(v.width) || !Number.isFinite(v.height))) {
    throw new Error(`renderlint: invalid viewports ${JSON.stringify(c.viewports)} (use widths like 375,768,1280 or WxH like 390x844)`);
  }
  for (const k of ['maxPages', 'timeout', 'serverTimeout', 'concurrency', 'minTapTarget', 'minFontSize', 'maxLineLength', 'maxScreenshotHeight']) {
    if (out[k] !== undefined && !(Number.isFinite(+out[k]) && +out[k] > 0)) throw new Error(`renderlint: "${k}" must be a positive number (got ${JSON.stringify(c[k])})`);
    if (out[k] !== undefined) out[k] = +out[k];
  }
  if (out.stress !== false && out.stress !== undefined && !(Number.isFinite(+out.stress) && +out.stress >= 1)) throw new Error(`renderlint: "stress" must be a factor >= 1 or false (got ${JSON.stringify(c.stress)})`);
  // sweep: true is the default list (the same array, so normalizing twice keeps it recognizable); an explicit list is used as is
  const defaultSweep = out.sweep === true || out.sweep === undefined || out.sweep === SWEEP_WIDTHS;
  out.sweepBreakpoints = out.sweepBreakpoints !== false && defaultSweep;
  out.sweep = out.sweep === false ? [] : defaultSweep ? SWEEP_WIDTHS : (Array.isArray(out.sweep) ? out.sweep : String(out.sweep).split(',')).map(Number);
  if (out.sweep.some((w) => !(w >= 200 && w <= 4000))) throw new Error(`renderlint: "sweep" must be true, false or a list of widths (got ${JSON.stringify(c.sweep)})`);
  out.mock = resolveMocks(c.mock, cwd, 'mock');
  out.mockFrom = (c.mockFrom === undefined || c.mockFrom === null ? [] : Array.isArray(c.mockFrom) ? c.mockFrom : [c.mockFrom]).map((f) => resolve(cwd, String(f)));
  out.auth = normalizeAuth(c.auth);
  if (!Array.isArray(out.states)) throw new Error('renderlint: "states" must be an array of { name, page, click, … }');
  out.states = out.states.map((st, i) => {
    if (!st || typeof st !== 'object' || !st.name) throw new Error(`renderlint: states[${i}] needs a "name"`);
    return { ...st, mock: resolveMocks(st.mock, cwd, `states[${i}].mock`) };
  });
  if (out.dedupe === 'true' || out.dedupe === 'identical' || out.dedupe === undefined) out.dedupe = true;
  if (out.dedupe === 'false' || out.dedupe === 'off') out.dedupe = false;
  if (![true, false, 'template'].includes(out.dedupe)) throw new Error(`renderlint: "dedupe" must be true, false or "template" (got ${JSON.stringify(c.dedupe)})`);
  if (!['error', 'warn', 'never'].includes(out.failOn)) throw new Error(`renderlint: "failOn" must be error | warn | never`);
  return out;
}

// "pattern": "file.json" serves a file (relative to the project); anything else is served as JSON.
function resolveMocks(mock, cwd, where) {
  if (mock === undefined || mock === null) return {};
  if (typeof mock !== 'object' || Array.isArray(mock)) throw new Error(`renderlint: "${where}" must map URL patterns to responses`);
  const out = {};
  for (const [pattern, v] of Object.entries(mock)) out[pattern] = typeof v === 'string' && /\.json$/i.test(v) ? { file: resolve(cwd, v) } : v && typeof v === 'object' && typeof v.file === 'string' ? { ...v, file: resolve(cwd, v.file) } : v;
  return out;
}

function defaultHeight(w) { return w <= 480 ? 812 : w <= 900 ? 1024 : 800; }
