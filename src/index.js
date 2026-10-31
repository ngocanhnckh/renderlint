// Programmatic API.
//   import { check } from '@ngocanhnckh/renderlint';
//   const result = await check({ url: 'http://localhost:5173' });
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, basename } from 'node:path';
import { loadConfig, normalize, DEFAULTS } from './config.js';
import { launchBrowser } from './browser.js';
import { serveStatic, startAndWait, waitForUrl, probe } from './server.js';
import { runChecks } from './runner.js';
import { mergeIssues, formatPretty, formatMarkdown, formatGithub } from './report.js';
import { scanSources } from './scan.js';
import { serverPlan } from './server-plan.js';
import { detectProject, detectWordPress, looksLikeWordPress, COMMON_PORTS } from './detect.js';
import { resolveStorybook, storyIndex, storybookConfig } from './storybook.js';

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
  const r = await probe(url, { timeout: 1500 });
  return !!r && r.status < 500;
}

// Is the server on this port really *this project's* dev server (and not some
// other app, or another project's Vite)? Vite only serves /@fs/ paths inside its
// own workspace, so asking for our package.json through it is a reliable check.
async function looksLikeDevServer(url, fw, cwd) {
  if (!['vite', 'sveltekit', 'astro', 'remix', 'react-router', 'qwik', 'nuxt', 'solid-start'].includes(fw.id)) return false;
  try {
    const r = await fetch(url + '/@fs' + cwd.split('\\').join('/') + '/package.json', { signal: AbortSignal.timeout(2000) });
    return r.status === 200;
  } catch { return false; }
}

// The first of these URLs that serves a WordPress page (following one redirect, e.g. to the canonical host).
export async function findWordPress(urls) {
  for (const url of urls) {
    let res = await probe(url, { timeout: 1500 });
    let at = url;
    if (res && res.status >= 300 && res.status < 400 && res.headers.location) {
      at = new URL(res.headers.location, url).href.replace(/\/$/, '');
      res = await probe(at, { timeout: 2500 });
    }
    if (looksLikeWordPress(res)) return new URL(at).origin + new URL(at).pathname.replace(/\/$/, '');
  }
  return null;
}

export async function resolveTargets(targets, config, cwd, log, { env } = {}) {
  const cleanup = [];
  try {
    return await resolveTargetsInner(targets, config, cwd, log, cleanup, env);
  } catch (e) {
    for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
    throw e;
  }
}

async function resolveTargetsInner(targets, config, cwd, log, cleanup, env) {
  const pages = [];
  let base, started = false;
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
    const srv = await serveStatic(root, { spa: isDir && existsSync(join(root, 'index.html')), base: config.base });
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
      const s = await startAndWait(config.serve, { url: base, cwd, timeout: config.serverTimeout, log, env });
      cleanup.push(s.stop);
      started = true;
    } else if (!(await reachable(base))) {
      await waitForUrl(base, { timeout: 15000 });
    }
  } else if (config.serve) {
    const s = await startAndWait(config.serve, { cwd, timeout: config.serverTimeout, log, env });
    cleanup.push(s.stop);
    started = true;
    base = new URL(s.url).origin;
    log(`Server ready at ${base}`);
  } else if (config.dir) {
    const srv = await serveStatic(resolve(cwd, config.dir), { base: config.base });
    cleanup.push(srv.close);
    base = srv.url;
  } else {
    // Zero-config: running dev server → dev script → static build → index.html
    const proj = detectProject(cwd);
    if (proj.wordpress) {
      // PHP renders the pages: find the local site (a theme's `npm run dev` usually only builds assets).
      const wp = proj.wordpress;
      base = await findWordPress(wp.urls);
      if (!base && wp.devCommand) {
        log(`Starting the local WordPress site: ${wp.devCommand}`);
        const s = await startAndWait(wp.devCommand, { url: wp.urls[0], cwd, timeout: config.serverTimeout, log });
        cleanup.push(s.stop);
        base = wp.urls[0];
      }
      if (!base) {
        throw new Error(`renderlint: this looks like a WordPress ${wp.kind} (${wp.name}), but no local WordPress site answered at ${wp.urls.slice(0, 4).join(', ')}.\n` +
          'Start your local site (wp-env, LocalWP, DDEV, Docker…) and pass its URL: `npx renderlint https://mysite.local`, or set "url" in renderlint.config.json.');
      }
      log(`Checking the WordPress site at ${base}`);
    }
    const ports = proj.framework ? [proj.framework.port, ...COMMON_PORTS.filter((p) => p !== proj.framework.port)] : [];
    for (const port of proj.pkg && !base ? ports.slice(0, 1) : []) {
      if (await looksLikeDevServer(`http://localhost:${port}`, proj.framework, cwd)) { base = `http://localhost:${port}`; log(`Using the dev server already running at ${base}`); break; }
    }
    if (!base && proj.devCommand) {
      log(`Starting ${proj.framework ? proj.framework.name + ' ' : ''}dev server: ${proj.devCommand}`);
      const s = await startAndWait(proj.devCommand, { cwd, timeout: config.serverTimeout, log, env });
      cleanup.push(s.stop);
      started = true;
      base = new URL(s.url).origin + new URL(s.url).pathname.replace(/\/$/, '');
    }
    if (!base && proj.staticDirs.length) {
      const srv = await serveStatic(join(cwd, proj.staticDirs[0]), { base: config.base });
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
  return { base, pages: Array.from(new Set(pages)), cleanup, started };
}

export async function check(options = {}) {
  const cwd = options.cwd || process.cwd();
  const log = options.log || (() => {});
  const { config: fileConfig } = options.configFile === false ? { config: normalize({ ...DEFAULTS }, cwd) } : await loadConfig(cwd, options.configFile);
  const config = normalize({ ...fileConfig, ...stripUndefined(options.config || {}), rules: { ...fileConfig.rules, ...((options.config || {}).rules || {}) } }, cwd);
  const started = Date.now();
  const targets = options.targets || (options.url ? [options.url] : []);
  // SSR apps fetch on the server: a server renderlint starts gets the preload that serves "mock" there too.
  const plan = options.storybook ? null : serverPlan(config);
  let urls, cleanup, base, startedServer = false;
  if (options.storybook) {
    // Every story of a Storybook, each in its own iframe page (src/storybook.js).
    const sb = await resolveStorybook(options.storybook.target, cwd, log);
    cleanup = sb.close ? [sb.close] : [];
    try {
      const stories = await storyIndex(sb.base);
      const variants = ['', ...((options.storybook.globals || config.storybook && config.storybook.globals) || [])];
      log(`Storybook at ${sb.base}: ${stories.length} stor${stories.length === 1 ? 'y' : 'ies'}${variants.length > 1 ? ' × ' + variants.length + ' globals variants' : ''}`);
      const r = storybookConfig(config, stories, sb.base, { globals: variants, include: options.storybook.stories || (config.storybook && config.storybook.stories) });
      if (!r.urls.length) throw new Error('renderlint: no story matches ' + JSON.stringify(options.storybook.stories || config.storybook.stories));
      urls = r.urls;
      base = sb.base;
      Object.assign(config, r.config);
    } catch (e) { for (const fn of cleanup) await Promise.resolve(fn()).catch(() => {}); throw e; }
  } else ({ pages: urls, cleanup, base, started: startedServer } = await resolveTargets(targets, config, cwd, log, { env: plan ? plan.env : undefined }));
  if (plan) {
    plan.setSelf(base || urls[0]);
    if (startedServer) log('Server-side mocks: the server renderlint started answers its own requests from "mock" too.');
  }
  // Make sure dev servers we started die with us (Ctrl+C, hook timeout, SIGTERM).
  const onSignal = (sig) => { for (const fn of cleanup) { try { fn(); } catch { /* ignore */ } } process.exit(sig === 'SIGINT' ? 130 : 143); };
  const onExit = () => { for (const fn of cleanup) { try { fn(); } catch { /* ignore */ } } };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); process.once('exit', onExit);
  let browser;
  try {
    browser = options.browser || await launchBrowser({ log });
    log(`Checking ${urls.length} page(s)${config.crawl ? ' (+ crawling links)' : ''} at ${config.viewports.map((v) => v.width).join('/')}px…`);
    const { issues: raw, pages } = config.roles ? await checkRoles(browser, { urls, base, config, log, plan }) : await runChecks(browser, { urls, config, log, serverLog: plan && plan.reader });
    let scanned = [];
    const doScan = options.scan !== undefined ? options.scan : config.scan && !options.storybook && !targets.some((t) => /^https?:/.test(t));
    if (doScan) { const wp = detectWordPress(cwd); scanned = scanSources({ cwd, dirs: config.scanDirs, rules: config.rules, wordpress: !!wp && wp.kind !== 'site' }); }
    const issues = mergeIssues([...raw, ...scanned], config);
    const schemes = Array.from(new Set(raw.map((i) => i.scheme).filter(Boolean)));
    const stats = {
      errors: issues.filter((i) => i.severity === 'error').reduce((n, i) => n + (i.count || 1), 0),
      warnings: issues.filter((i) => i.severity === 'warn').reduce((n, i) => n + (i.count || 1), 0),
      findings: issues.length,
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
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); process.removeListener('exit', onExit);
    if (browser && !options.browser) await browser.close().catch(() => {});
    for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
  }
}

// Every role is a run of its own: its own session ("auth"), its mocks over the top-level ones (in the
// browser and, through the preload, on the server: a "renderlint-role" cookie tells it which role a
// request is for), the entry pages plus the role's own pages, and its page names labelled "[role: name]".
async function checkRoles(browser, { urls, base, config, log, plan }) {
  const all = { issues: [], pages: [] };
  for (const [name, role] of Object.entries(config.roles)) {
    log(`Role ${name}:`);
    const root = base || new URL(urls[0]).origin;
    const own = role.pages.map((p) => (/^https?:/.test(p) ? p : root + (p.startsWith('/') ? p : '/' + p)));
    const roleConfig = { ...config, auth: 'auth' in role ? role.auth : config.auth, mock: { ...config.mock, ...role.mock }, role: { name, pages: own } };
    const r = await runChecks(browser, { urls: Array.from(new Set([...urls, ...own])), config: roleConfig, log, serverLog: plan && plan.reader });
    all.issues.push(...r.issues);
    all.pages.push(...r.pages);
  }
  return all;
}

function stripUndefined(o) { return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)); }
