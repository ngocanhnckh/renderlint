// Route coverage for one run: which routes the app has, which URLs stand for each, which ones get
// checked, and what happened to every route, so no page is skipped without saying so.
//
//   const cov = await createCoverage({ cwd, base, config, log });
//   cov.seeds()                    URLs to start with (static routes + chosen instances of dynamic ones)
//   cov.onLink(href)               a link seen while crawling: 'check' (check it) | 'candidate' (counted only) | 'skip'
//   cov.onJson(apiUrl, body)       an API response: ids/slugs in lists become instances of matching routes
//   cov.onResult(url, result)      what checking the URL gave (status, redirect, sign-in, access denied)
//   cov.summary()                  { urls, routes, counts, list: [{ pattern, status, … }] }
import { discoverRoutes, fillPattern, normPattern } from './discover.js';
import { matchRoute, inferPatterns, compile } from './match.js';
import { sitemapUrls } from './sitemap.js';
import { globMatch } from '../runner.js';

const ID_LIKE = /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,}|[a-z]{1,3}\d+[a-z0-9]*)$/i;
const LOGIN = /(^|[/#_-])(log-?in|sign-?in|signin|auth|sso|session\/new|account\/login)([/?#._-]|$)/i;
const DENIED_PATH = /(^|\/)(403|401|forbidden|unauthori[sz]ed|access-denied|denied|no-access|not-allowed)(\/|$)/i;

export async function createCoverage({ cwd, base, config, log = () => {}, discovered }) {
  const opts = normalizeCoverage(config);
  const found = discovered || (opts.routes === false ? { routes: [], prerendered: [], notes: [], framework: null } : discoverRoutes(cwd));
  const routes = found.routes.map((r) => ({ ...r, candidates: new Map(), checked: [], results: [] }));
  const origin = new URL(base).origin;
  const basePath = new URL(base).pathname.replace(/\/$/, '');
  const add = (r, path, source, data) => {
    path = normPattern(path);
    if (!r.candidates.has(path)) r.candidates.set(path, { source, data, order: r.candidates.size });
    return path;
  };
  const outside = new Map(); // path -> source, URLs no discovered route serves
  for (const r of routes) {
    if (!r.dynamic) { add(r, r.pattern, 'route'); continue; }
    for (const v of r.values || []) { const u = fillPattern(r.pattern, v); if (u) add(r, u, 'static params'); }
    // optional params: the bare URL is an instance too (/shop for /shop/:filters*)
    const bare = fillPattern(r.pattern, {});
    if (bare) add(r, bare, 'route');
  }
  // values from config: params: { '/products/:id': ['a1', 'b2'] | [{ id: 'a1' }] }
  for (const [pattern, list] of Object.entries(opts.params || {})) {
    const r = routes.find((x) => x.pattern === normPattern(pattern)) || (() => { const n = { pattern: normPattern(pattern), file: null, files: [], params: [], dynamic: true, source: 'config', candidates: new Map(), checked: [], results: [] }; n.params = Array.from(n.pattern.matchAll(/:(\w+)/g), (m) => m[1]); routes.push(n); return n; })();
    for (const v of Array.isArray(list) ? list : [list]) {
      const vals = v && typeof v === 'object' && !Array.isArray(v) ? v : { [r.params[0]]: v };
      const u = fillPattern(r.pattern, vals);
      if (u) add(r, u, 'config');
    }
  }
  const place = (path, source) => {
    const m = matchRoute(routes, path);
    if (m) return add(m.route, path, source);
    if (!outside.has(path)) outside.set(path, source);
    return null;
  };
  for (const u of found.prerendered || []) place(u, 'build manifest');
  let sitemap = null;
  if (opts.sitemap !== false && /^https?:/.test(base)) {
    sitemap = await sitemapUrls(base).catch(() => null);
    if (sitemap && sitemap.urls.length) {
      for (const u of sitemap.urls) place(basePath && u.startsWith(basePath) ? u.slice(basePath.length) || '/' : u, 'sitemap');
      log(`  sitemap: ${sitemap.urls.length} URL(s) from ${sitemap.sources.join(', ')}`);
    }
  }
  if (routes.length) log(`  routes: ${routes.length} found in the source (${found.framework})${found.notes.length ? '; ' + found.notes.join('; ') : ''}`);

  const per = opts.perRoute;
  const excluded = (p) => (config.exclude || []).some((g) => globMatch(g, p)) || (opts.ignore || []).some((g) => globMatch(g, p));
  const queued = new Set();
  const queue = (r, path) => { if (queued.has(path)) return false; if (r.checked.length >= per) return false; queued.add(path); r.checked.push(path); return true; };
  const api = new Map(); // route pattern -> values seen in API lists
  const shapes = new Map(); // URL shape (ids as :id) -> checked, for URLs outside the routes

  // the URL as listed (path, query, hash route) and the part the app's routes match (the hash for hash routers)
  const hashRouter = routes.some((r) => r.hash);
  const pathsOf = (u) => {
    let p = u.pathname + (u.search || '');
    if (basePath && p.startsWith(basePath)) p = p.slice(basePath.length) || '/';
    const h = /^#!?\//.test(u.hash) ? u.hash : '';
    return { path: p + h, routePath: hashRouter ? (h ? h.replace(/^#!?/, '') : '/') : h ? null : p };
  };
  const outsideDecision = (path) => {
    if (excluded(path)) return 'skip';
    if (queued.has('outside:' + path)) return 'candidate';
    const shape = path.replace(/[?#].*$/, '').split('/').map((x) => (ID_LIKE.test(x) ? ':id' : x)).join('/');
    const n = shapes.get(shape) || 0;
    if (n >= per) return 'candidate';
    shapes.set(shape, n + 1);
    queued.add('outside:' + path);
    return 'check';
  };
  const cov = {
    routes, outside, framework: found.framework, sitemap, perRoute: per, opts,
    // static routes first, then instances of dynamic routes, chosen for variety
    seeds() {
      const out = [];
      for (const r of routes) {
        if (excluded(r.pattern)) continue;
        for (const path of choose(r, per)) if (queue(r, path)) out.push(origin + basePath + (r.hash ? '/#' + path : path));
      }
      for (const [p] of outside) if (outsideDecision(p) === 'check') out.push(origin + basePath + p);
      return out;
    },
    // a link found on a checked page
    onLink(href) {
      let u; try { u = new URL(href); } catch { return 'skip'; }
      const { path, routePath } = pathsOf(u);
      const m = routePath !== null ? matchRoute(routes, routePath) : null;
      if (!m) {
        // no route of the source serves it (or there is no source): group by shape, ids as one segment
        if (!outside.has(path)) outside.set(path, 'link');
        return outsideDecision(path);
      }
      const p = add(m.route, routePath, 'link');
      if (excluded(p)) return 'skip';
      return queue(m.route, p) ? 'check' : 'candidate';
    },
    // API responses: arrays of objects with an id/slug become values of routes that take that param
    onJson(apiUrl, body) {
      const lists = listsIn(body);
      if (!lists.length) return [];
      const apiSegs = new URL(apiUrl).pathname.toLowerCase().split('/').filter(Boolean);
      const out = [];
      for (const r of routes) {
        if (!r.dynamic || r.params.length !== 1 || excluded(r.pattern)) continue;
        const name = r.params[0];
        const statics = r.pattern.split('/').filter((s) => s && !s.startsWith(':')).map((s) => s.toLowerCase());
        const last = statics[statics.length - 1];
        // the API path must name the same resource as the route (/api/users ↔ /users/:id)
        if (!last || !apiSegs.some((s) => s === last || s === last + 's' || s + 's' === last)) continue;
        for (const items of lists) {
          const key = [name, 'id', 'slug', 'uuid', 'key', 'code'].find((k) => items.every((it) => it && (typeof it[k] === 'string' || typeof it[k] === 'number')));
          if (!key) continue;
          for (const it of items.slice(0, 500)) {
            const path = fillPattern(r.pattern, { [name]: String(it[key]) });
            if (!path || r.candidates.has(path)) continue;
            add(r, path, 'api ' + new URL(apiUrl).pathname, it);
            if (!api.has(r.pattern)) api.set(r.pattern, 0);
            api.set(r.pattern, api.get(r.pattern) + 1);
          }
        }
        // the first ones are checked as soon as they are known, the rest chosen for variety
        for (const path of choose(r, per)) if (queue(r, path)) out.push(origin + basePath + path);
      }
      return out;
    },
    onResult(url, res) {
      let u; try { u = new URL(url); } catch { return; }
      const { path, routePath } = pathsOf(u);
      const m = routePath !== null ? matchRoute(routes, routePath) : null;
      const r = m ? m.route : null;
      const status = classify(path, res, r);
      if (r) r.results.push({ path: routePath, ...status });
      else (cov.outsideResults = cov.outsideResults || new Map()).set(path, status);
    },
    summary() { return summarize(cov); },
  };
  return cov;
}

export function normalizeCoverage(config) {
  const c = config.coverage && typeof config.coverage === 'object' ? config.coverage : {};
  return {
    routes: config.routes !== false,
    perRoute: Math.max(1, +(c.perRoute || config.perRoute || 2)),
    params: { ...(config.params || {}), ...(c.params || {}) },
    sitemap: c.sitemap !== undefined ? c.sitemap : config.sitemap,
    min: c.min !== undefined ? +c.min : undefined,
    ignore: c.ignore || [],
    baseline: c.baseline,
  };
}

// Arrays of objects anywhere in a JSON body ({ items: [...] }, [...], { data: { rows: [...] } }).
function listsIn(body, depth = 0, out = []) {
  if (depth > 3 || !body || typeof body !== 'object') return out;
  if (Array.isArray(body)) { if (body.length && body.every((x) => x && typeof x === 'object' && !Array.isArray(x))) out.push(body); return out; }
  for (const v of Object.values(body)) listsIn(v, depth + 1, out);
  return out;
}

// Up to n instances of a route, for variety: the bare/optional form, then the extremes of the
// candidates' size (a long slug or a big API record often means long text on the page), then the rest
// in the order they were found.
export function choose(r, n) {
  const all = Array.from(r.candidates, ([path, c]) => ({ path, ...c }));
  if (!all.length) return [];
  if (!r.dynamic || all.length <= n) return all.map((c) => c.path).slice(0, n);
  const size = (c) => (c.data ? JSON.stringify(c.data).length : 0) + c.path.length;
  const picked = [];
  const take = (c) => { if (c && !picked.includes(c.path)) picked.push(c.path); };
  take(all.find((c) => c.source === 'route')); // /shop for /shop/:filters*
  const bySize = all.slice().sort((a, b) => size(b) - size(a) || a.order - b.order);
  take(bySize[0]);
  for (const c of all) { if (picked.length >= n) break; take(c); }
  return picked.slice(0, n);
}

function classify(path, res, route) {
  if (res.error) return { status: 'error', reason: res.error };
  if (res.authRequired) return { status: 'needs-auth', reason: 'sent to sign-in (' + res.authRequired + ')' };
  const final = res.finalUrl ? (() => { try { const f = new URL(res.finalUrl); return f.pathname + f.search; } catch { return null; } })() : null;
  if (res.httpStatus === 401 || res.httpStatus === 403) return { status: 'needs-role', reason: `HTTP ${res.httpStatus}` };
  if (res.httpStatus >= 400) return { status: 'unreachable', reason: `HTTP ${res.httpStatus}` };
  if (final && normPattern(final.replace(/[?#].*$/, '')) !== normPattern(path.replace(/[?#].*$/, ''))) {
    if (LOGIN.test(final)) return { status: 'needs-auth', reason: 'redirected to ' + final };
    if (DENIED_PATH.test(final)) return { status: 'needs-role', reason: 'redirected to ' + final };
    if (route && route.guards && route.guards.length) return { status: 'needs-role', reason: `redirected to ${final} (route guard: ${route.guards[0]})` };
    return { status: 'redirected', reason: 'redirected to ' + final };
  }
  if (res.denied) return { status: 'needs-role', reason: `the page says "${res.denied}"` };
  return { status: 'checked' };
}

const ORDER = ['checked', 'needs-auth', 'needs-role', 'needs-params', 'redirected', 'unreachable', 'error', 'not-checked', 'excluded'];
function summarize(cov) {
  const list = [];
  const urls = new Set();
  const excluded = (p) => (cov.opts.ignore || []).some((g) => globMatch(g, p));
  for (const r of cov.routes) {
    for (const p of r.candidates.keys()) urls.add(p);
    let status, reason;
    const ok = r.results.filter((x) => x.status === 'checked');
    if (excluded(r.pattern)) { status = 'excluded'; reason = 'coverage.ignore'; }
    else if (ok.length) status = 'checked';
    else if (r.results.length) {
      // the most telling reason across instances
      const best = r.results.slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
      status = best.status; reason = best.reason;
    } else if (r.dynamic && !r.candidates.size) { status = 'needs-params'; reason = `no value for ${r.params.map((p) => ':' + p).join(', ')} (no link, sitemap entry, API list or build manifest named one; set "params")`; }
    else { status = 'not-checked'; reason = r.checked.length ? 'page limit (maxPages) reached' : 'excluded by "exclude"'; }
    list.push({ pattern: r.pattern, file: r.file, status, reason, instances: r.candidates.size, checked: ok.map((x) => x.path), tried: r.results.length, guards: r.guards, sources: Array.from(new Set(Array.from(r.candidates.values(), (c) => c.source))) });
  }
  // URLs that no discovered route serves (rewrites, a CMS, a site without source)
  const outsidePaths = Array.from(cov.outside.keys());
  const groups = inferPatterns(outsidePaths);
  for (const g of groups) {
    for (const u of g.urls) urls.add(u);
    const res = g.urls.map((u) => cov.outsideResults && cov.outsideResults.get(u)).filter(Boolean);
    const ok = res.filter((x) => x.status === 'checked');
    const best = res.slice().sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status))[0];
    list.push({ pattern: g.pattern, file: null, inferred: true, status: excluded(g.pattern) ? 'excluded' : ok.length ? 'checked' : best ? best.status : 'not-checked', reason: !ok.length && best ? best.reason : !ok.length ? 'not checked (page limit)' : undefined, instances: g.urls.length, checked: g.urls.filter((u) => cov.outsideResults && cov.outsideResults.get(u) && cov.outsideResults.get(u).status === 'checked'), tried: res.length, sources: ['seen'] });
  }
  const counts = {};
  for (const x of list) counts[x.status] = (counts[x.status] || 0) + 1;
  const considered = list.filter((x) => x.status !== 'excluded');
  const percent = considered.length ? Math.round((counts.checked || 0) / considered.length * 1000) / 10 : 100;
  return { urls: urls.size, routes: list.length, counts, percent, perRoute: cov.perRoute, framework: cov.framework, list: list.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.pattern.localeCompare(b.pattern)) };
}

// "412 URLs, 38 routes: 35 checked, 2 need a role, 1 not reachable"
export function coverageLine(s) {
  const words = { checked: 'checked', 'needs-auth': 'need sign-in', 'needs-role': 'need a role', 'needs-params': 'need param values', redirected: 'redirect elsewhere', unreachable: 'not reachable', error: 'failed to load', 'not-checked': 'not checked', excluded: 'excluded' };
  const parts = ORDER.filter((k) => s.counts[k]).map((k) => `${s.counts[k]} ${words[k]}`);
  return `${s.urls} URL(s), ${s.routes} route(s): ${parts.join(', ')}`;
}

// Coverage gate: below `min` percent, or (with a baseline) a route that was checked before and isn't now.
export function coverageGate(s, { min, baseline } = {}) {
  const fails = [];
  if (min !== undefined && s.percent < min) fails.push(`route coverage ${s.percent}% is below the minimum of ${min}%`);
  if (baseline && baseline.list) {
    const now = new Map(s.list.map((x) => [x.pattern, x.status]));
    for (const b of baseline.list) if (b.status === 'checked' && now.get(b.pattern) !== 'checked') fails.push(`${b.pattern} was checked in the baseline and is now ${now.get(b.pattern) || 'gone'}`);
  }
  return fails;
}

export { compile };
