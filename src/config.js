import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from './rules-meta.js';

export const DEFAULTS = {
  url: undefined,          // base URL of a running app
  serve: undefined,        // command that starts a server (e.g. "npm run dev")
  dir: undefined,          // static directory to serve (e.g. "dist")
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
  stress: false,           // e.g. 1.5 = re-check with 50% longer text (reports fragile-layout)
  scan: true,              // static source scan (emoji, placeholder copy) in addition to rendering
  scanDirs: undefined,
  contrastLevel: 'AA',
  minTapTarget: 24,
  minFontSize: 12,
  maxLineLength: 120,
  concurrency: 3,          // viewports checked in parallel
  timeout: 30000,
  serverTimeout: 120000,
  maxScreenshotHeight: 12000,
  waitFor: undefined,      // selector to wait for before checking
  delay: 0,                // extra ms to wait after load
};

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
  return { config: normalize({ ...DEFAULTS, ...user }), file };
}

export function normalize(c) {
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
  out.outputDir = resolve(out.outputDir);
  return out;
}

function defaultHeight(w) { return w <= 480 ? 812 : w <= 900 ? 1024 : 800; }
