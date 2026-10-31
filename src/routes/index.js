// Route coverage for a check() run, and the page map the agent hook uses to re-check only what an
// edit can affect.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCoverage, coverageGate, coverageLine, normalizeCoverage } from './plan.js';
import { discoverRoutes, detectRouting, discoverEndpoints } from './discover.js';
import { buildGraph, routeClosures, shellEntries, snapshot, closure } from './graph.js';
import { matchRoute } from './match.js';
import { rel } from './resolve.js';

export { coverageLine } from './plan.js';
export { discoverRoutes } from './discover.js';

// Coverage is on when renderlint looks for pages itself (crawl), or when asked for (routes: true).
export async function startCoverage({ cwd, base, config, log, pagesGiven }) {
  if (config.routes === false) return null;
  if (!config.crawl && config.routes !== true) return null;
  if (pagesGiven && config.routes !== true) return null; // files or URLs listed on the command line: check those
  const framework = detectRouting(cwd);
  const discovered = framework ? discoverRoutes(cwd, { framework }) : { framework: null, routes: [], prerendered: [], notes: [] };
  const t0 = Date.now();
  const cov = await createCoverage({ cwd, base, config, log, discovered });
  cov.discoveryMs = Date.now() - t0;
  cov.cwd = cwd;
  return cov;
}

export function finishCoverage(cov, { pages, issues, config }) {
  const s = cov.summary();
  s.discoveryMs = cov.discoveryMs;
  const opts = normalizeCoverage(config);
  let baseline = null;
  if (opts.baseline) { try { baseline = JSON.parse(readFileSync(resolve(cov.cwd, opts.baseline), 'utf8')); } catch { /* none yet */ } }
  s.gate = coverageGate(s, { min: opts.min, baseline });
  s.line = coverageLine(s);
  // errors per route, for the hook's per-route state
  const errorsByPath = new Map();
  for (const i of issues) if (i.severity === 'error') for (const p of i.pages || []) errorsByPath.set(p, (errorsByPath.get(p) || 0) + 1);
  for (const r of s.list) r.errors = (r.checked || []).reduce((n, p) => n + (errorsByPath.get(p) || 0), 0);
  mkdirSync(config.outputDir, { recursive: true });
  writeFileSync(join(config.outputDir, 'coverage.json'), JSON.stringify(s, null, 1));
  if (cov.routes.length) writePageMap(cov, s, pages, config);
  return s;
}

// .renderlint/page-map.json: route -> the project files it renders with (static import graph, plus
// the files the browser loaded for it) and the URLs checked for it, with the file state of this run.
function writePageMap(cov, s, pages, config) {
  try {
    const cwd = cov.cwd;
    const graph = buildGraph(cwd, { framework: cov.framework, routes: cov.routes.filter((r) => r.files && r.files.length), entries: shellEntries(cwd, cov.framework) });
    const { shell, per } = routeClosures(graph);
    const runtime = runtimeFiles(cwd, cov.framework, cov.routes, pages.filter((p) => p.resources).map((p) => [p.path, p.resources]), graph);
    const list = graph.routes.map((r, i) => {
      const cs = s.list.find((x) => x.pattern === r.pattern) || {};
      return { pattern: r.pattern, file: r.file, files: Array.from(new Set([...Array.from(per[i], (f) => rel(cwd, f)), ...(runtime.get(r.pattern) || [])])).sort(), checked: cs.checked || [], status: cs.status, errors: cs.errors || 0 };
    });
    writeFileSync(join(config.outputDir, 'page-map.json'), JSON.stringify({ version: 1, framework: cov.framework, createdAt: new Date().toISOString(), shell: Array.from(shell, (f) => rel(cwd, f)).sort(), routes: list, snapshot: snapshot(cwd) }, null, 1));
  } catch (e) {
    // the page map only speeds up later runs
    if (process.env.RENDERLINT_DEBUG) console.error('page map: ' + e.message);
  }
}

// Files a route's pages loaded at runtime: source modules (Vite dev), public/ assets, and the code of
// the project's own API endpoints it fetched (a client page rendering /api/users renders that handler's data).
export function runtimeFiles(cwd, framework, routes, visits, graph) {
  const endpoints = discoverEndpoints(cwd, framework);
  const out = new Map();
  for (const [path, resources] of visits) {
    const m = matchRoute(routes, path);
    if (!m) continue;
    const files = out.get(m.route.pattern) || new Set();
    for (const r of resources) {
      const f = resourceFile(cwd, r);
      if (f) { files.add(f); continue; }
      const e = endpoints.length && matchRoute(endpoints, r);
      if (e) for (const x of closure(graph, [resolve(cwd, e.route.file)])) files.add(rel(cwd, x));
    }
    out.set(m.route.pattern, files);
  }
  return out;
}

// A URL path the page loaded → the project file behind it (Vite: /src/x.tsx, /@fs/abs; public/ assets).
function resourceFile(cwd, path) {
  const p = decodeURIComponent(path.replace(/\?.*$/, ''));
  if (p.startsWith('/@fs/')) { const abs = p.slice(4); return abs.startsWith(cwd + '/') && existsSync(abs) ? rel(cwd, abs) : null; }
  if (/^\/(@vite|@id|@react-refresh|node_modules|_next|_nuxt|__vite|@vite-plugin)/.test(p)) return null;
  for (const c of [p.slice(1), 'public' + p, 'static' + p]) if (c && existsSync(join(cwd, c)) && !c.endsWith('/')) return c;
  return null;
}
