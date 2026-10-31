// Change-based selection for the agent hook: after a full run wrote .renderlint/page-map.json, an edit
// re-checks only the routes whose pages render with the changed files (plus every route for the app
// shell, config, global CSS through the root layout, or files we can't place). Routes that had errors
// and are not affected keep them: the verdict is the one a full run would give.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { discoverRoutes } from './discover.js';
import { buildGraph, routeClosures, affectedRoutes, shellEntries, snapshot, diffSnapshots } from './graph.js';
import { matchRoute } from './match.js';

export function readPageMap(outputDir) {
  const p = join(outputDir, 'page-map.json');
  if (!existsSync(p)) return null;
  try { const m = JSON.parse(readFileSync(p, 'utf8')); return m && m.version === 1 ? m : null; } catch { return null; }
}

// { mode: 'none' | 'some' | 'all', paths: [url paths to check], routes: [patterns], reasons, changed }
export function planIncremental(cwd, map) {
  const now = snapshot(cwd);
  const changed = diffSnapshots(map.snapshot || {}, now);
  const failing = map.routes.filter((r) => r.errors > 0);
  if (!changed.length) return { mode: 'none', paths: [], routes: [], reasons: [], changed, now, failing };
  const d = discoverRoutes(cwd, { framework: map.framework });
  const g = buildGraph(cwd, { framework: map.framework, routes: d.routes, entries: shellEntries(cwd, map.framework) });
  const cl = routeClosures(g);
  // what the browser loaded in the full run (source modules, assets, the project's API endpoints) counts too
  d.routes.forEach((r, i) => { const old = map.routes.find((x) => x.pattern === r.pattern); if (old) for (const f of old.files) cl.per[i].add(resolve(cwd, f)); });
  const sel = affectedRoutes(g, changed, { closures: cl, previousRoutes: map.routes.map((r) => ({ ...r, files: r.files })) });
  if (sel.all) return { mode: 'all', paths: [], routes: [], reasons: sel.reasons, changed, now };
  const patterns = new Set(Array.from(sel.routes, (i) => d.routes[i].pattern));
  const paths = [];
  const missing = [];
  for (const p of patterns) {
    const old = map.routes.find((x) => x.pattern === p);
    const r = d.routes.find((x) => x.pattern === p);
    if (old && old.checked.length) paths.push(...old.checked);
    else if (r && !r.dynamic) paths.push(r.pattern);
    else missing.push(p); // a new dynamic route: no instance known yet
  }
  if (missing.length) return { mode: 'all', paths: [], routes: [], reasons: [...sel.reasons, `new route(s) without known instances: ${missing.join(', ')}`], changed, now };
  return { mode: paths.length ? 'some' : 'none', paths: Array.from(new Set(paths)), routes: Array.from(patterns), reasons: sel.reasons, changed, now, failing };
}

// After an incremental run: new file state, and the errors of the routes that were re-checked.
export function updatePageMap(outputDir, map, plan, result) {
  const errorsByPath = new Map();
  for (const i of result.issues) if (i.severity === 'error') for (const p of i.pages || []) errorsByPath.set(p, (errorsByPath.get(p) || 0) + 1);
  const rechecked = new Set(plan.routes);
  for (const r of map.routes) if (rechecked.has(r.pattern)) r.errors = r.checked.reduce((n, p) => n + (errorsByPath.get(p) || 0), 0);
  // a static route that is new since the full run
  for (const p of plan.routes) if (!map.routes.some((r) => r.pattern === p)) map.routes.push({ pattern: p, files: [], checked: [p], status: 'checked', errors: errorsByPath.get(p) || 0 });
  map.snapshot = plan.now;
  map.updatedAt = new Date().toISOString();
  writeFileSync(join(outputDir, 'page-map.json'), JSON.stringify(map, null, 1));
  return map.routes.filter((r) => r.errors > 0 && !rechecked.has(r.pattern));
}

export { matchRoute };
