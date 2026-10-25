// Programmatic API.
//   import { check } from 'renderlint';
//   const result = await check({ url: 'http://localhost:5173' });
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { loadConfig, normalize, DEFAULTS } from './config.js';
import { launchBrowser } from './browser.js';
import { serveStatic, startAndWait, waitForUrl } from './server.js';
import { runChecks } from './runner.js';
import { mergeIssues, formatPretty, formatMarkdown, formatGithub } from './report.js';
import { scanSources } from './scan.js';
import { detectProject, COMMON_PORTS } from './detect.js';

export { RULES, RULE_IDS } from './rules-meta.js';
export { analyzerSource } from './analyzer/bundle.js';
export { formatPretty, formatMarkdown, formatGithub };

function htmlFilesIn(dir, max = 50) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6 || out.length >= max) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.html?$/.test(e.name) && e.name !== '404.html') out.push(p);
    }
  };
  walk(dir, 0);
  return out;
}

async function reachable(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(1500) }); return r.status < 500; } catch { return false; }
}

// Decide what to check: returns { base, pages, cleanup[] }
async function resolveTargets(targets, config, cwd, log) {
  const cleanup = [];
  const pages = [];
  let base;
  const urls = targets.filter((t) => /^https?:\/\//.test(t));
  const paths = targets.filter((t) => !/^https?:\/\//.test(t));

  if (urls.length) {
    base = new URL(urls[0]).origin;
    pages.push(...urls);
  } else if (paths.length) {
    const p = resolve(cwd, paths[0]);
    if (!existsSync(p)) throw new Error(`renderlint: ${paths[0]} does not exist`);
    const isDir = statSync(p).isDirectory();
    const root = isDir ? p : dirname(p);
    const srv = await serveStatic(root, { spa: isDir && existsSync(join(root, 'index.html')) });
    cleanup.push(srv.close);
    base = srv.url;
    if (isDir) {
      const files = htmlFilesIn(root, config.maxPages);
      const idx = files.find((f) => f === join(root, 'index.html'));
      const ordered = idx ? [idx, ...files.filter((f) => f !== idx)] : files;
      if (!ordered.length) throw new Error(`renderlint: no .html files found in ${paths[0]}`);
      for (const f of ordered) pages.push(base + '/' + relative(root, f).split('\\').join('/'));
      for (const extra of paths.slice(1)) pages.push(base + '/' + relative(root, resolve(cwd, extra)));
    } else {
      for (const f of paths) pages.push(base + '/' + relative(root, resolve(cwd, f)).split('\\').join('/'));
    }
    log(`Serving ${relative(cwd, root) || '.'} at ${base}`);
  } else if (config.url) {
    base = config.url.replace(/\/$/, '');
    if (config.serve && !(await reachable(base))) {
      const s = await startAndWait(config.serve, { url: base, cwd, timeout: config.serverTimeout, log });
      cleanup.push(s.stop);
    } else if (!(await reachable(base))) {
      await waitForUrl(base, { timeout: 15000 });
    }
  } else if (config.serve) {
    const s = await startAndWait(config.serve, { cwd, timeout: config.serverTimeout, log });
    cleanup.push(s.stop);
    base = new URL(s.url).origin;
    log(`Server ready at ${base}`);
  } else if (config.dir) {
    const srv = await serveStatic(resolve(cwd, config.dir));
    cleanup.push(srv.close);
    base = srv.url;
  } else {
    // Zero-config: running dev server → dev script → static build → index.html
    const proj = detectProject(cwd);
    const ports = proj.framework ? [proj.framework.port, ...COMMON_PORTS.filter((p) => p !== proj.framework.port)] : [];
    for (const port of proj.pkg ? ports.slice(0, 1) : []) {
      if (await reachable(`http://localhost:${port}`)) { base = `http://localhost:${port}`; log(`Using the dev server already running at ${base}`); break; }
    }
    if (!base && proj.devCommand) {
      log(`Starting ${proj.framework ? proj.framework.name + ' ' : ''}dev server: ${proj.devCommand}`);
      const s = await startAndWait(proj.devCommand, { cwd, timeout: config.serverTimeout, log });
      cleanup.push(s.stop);
      base = new URL(s.url).origin + new URL(s.url).pathname.replace(/\/$/, '');
    }
    if (!base && proj.staticDirs.length) {
      const srv = await serveStatic(join(cwd, proj.staticDirs[0]));
      cleanup.push(srv.close);
      base = srv.url;
      log(`Serving static build ${proj.staticDirs[0]}/ at ${base}`);
    }
    if (!base && proj.hasIndexHtml) {
      const srv = await serveStatic(cwd);
      cleanup.push(srv.close);
      base = srv.url;
      const files = htmlFilesIn(cwd, config.maxPages).filter((f) => !/[\\/](dist|build|out)[\\/]/.test(f));
      for (const f of files) pages.push(base + '/' + relative(cwd, f).split('\\').join('/'));
      log(`Serving ${basename(cwd)}/ at ${base}`);
    }
    if (!base) {
      throw new Error('renderlint: nothing to check. Pass a URL (renderlint http://localhost:3000), an HTML file/dir (renderlint dist), ' +
        'or set "url"/"serve" in renderlint.config.json (run `npx renderlint init`).');
    }
  }
  if (!pages.length) for (const p of config.pages) pages.push(/^https?:/.test(p) ? p : base + (p.startsWith('/') ? p : '/' + p));
  return { base, pages: Array.from(new Set(pages)), cleanup };
}

export async function check(options = {}) {
  const cwd = options.cwd || process.cwd();
  const log = options.log || (() => {});
  const { config: fileConfig } = options.configFile === false ? { config: normalize({ ...DEFAULTS }) } : await loadConfig(cwd, options.configFile);
  const config = normalize({ ...fileConfig, ...stripUndefined(options.config || {}), rules: { ...fileConfig.rules, ...((options.config || {}).rules || {}) } });
  const started = Date.now();
  const targets = options.targets || (options.url ? [options.url] : []);
  const { pages: urls, cleanup } = await resolveTargets(targets, config, cwd, log);
  let browser;
  try {
    browser = options.browser || await launchBrowser({ log });
    log(`Checking ${urls.length} page(s)${config.crawl ? ' (+ crawling links)' : ''} at ${config.viewports.map((v) => v.width).join('/')}px…`);
    const { issues: raw, pages } = await runChecks(browser, { urls, config, log });
    let scanned = [];
    const doScan = options.scan !== undefined ? options.scan : config.scan && !targets.some((t) => /^https?:/.test(t));
    if (doScan) scanned = scanSources({ cwd, dirs: config.scanDirs, rules: config.rules });
    const issues = mergeIssues([...raw, ...scanned], config);
    const schemes = Array.from(new Set(raw.map((i) => i.scheme).filter(Boolean)));
    const stats = {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warn').length,
      pages: pages.length, ms: Date.now() - started, scanned: scanned.length,
      schemes: schemes.length ? schemes : ['light'],
      suppressed: 0,
    };
    const result = { ok: config.failOn === 'never' ? true : config.failOn === 'warn' ? stats.errors + stats.warnings === 0 : stats.errors === 0, issues, pages, stats, config };
    mkdirSync(config.outputDir, { recursive: true });
    writeFileSync(join(config.outputDir, 'report.json'), JSON.stringify({ ok: result.ok, stats, pages, issues }, null, 2));
    writeFileSync(join(config.outputDir, 'report.md'), formatMarkdown(result));
    return result;
  } finally {
    if (browser && !options.browser) await browser.close().catch(() => {});
    for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
  }
}

function stripUndefined(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); }
