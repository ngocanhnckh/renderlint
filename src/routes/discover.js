// Static route discovery: every page an app defines, read from its source tree without running it.
//
//   discoverRoutes(cwd) -> { framework, routes: [Route], notes: [string] }
//   Route: { pattern: '/products/:id', file: 'app/products/[id]/page.tsx', files: [page + layouts],
//            params: ['id'], dynamic: true, values?: [{ id: '1' }], guards?: [...], source }
//
// Pattern syntax (one for all frameworks): /static, :name (one segment), :name? (optional),
// :name+ (one or more segments), :name* (zero or more).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripComments, parseExpr, declarations, declaredNames, importMap, jsxElementsIn, literal } from './jsparse.js';
import { loadAliases, resolveImport, rel } from './resolve.js';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const ls = (d) => { try { return readdirSync(d, { withFileTypes: true }).filter((e) => e.name !== 'node_modules' && !e.name.startsWith('.')); } catch { return []; } };
const pkgDeps = (cwd) => { try { const p = JSON.parse(read(join(cwd, 'package.json'))); return { ...p.dependencies, ...p.devDependencies }; } catch { return {}; } };

export function paramsOf(pattern) {
  return Array.from(pattern.matchAll(/:([A-Za-z_$][\w$]*)([?+*]?)/g), (m) => m[1]);
}

function mkRoute(cwd, pattern, file, layouts, source, extra = {}) {
  pattern = normPattern(pattern);
  const params = paramsOf(pattern);
  return { pattern, file: file && rel(cwd, file), files: [...new Set([file, ...layouts].filter(Boolean).map((f) => rel(cwd, f)))], params, dynamic: params.length > 0, source, ...extra };
}

export function normPattern(p) {
  p = ('/' + p).replace(/\/+/g, '/');
  if (p.length > 1) p = p.replace(/\/$/, '');
  return p;
}

// ---------------------------------------------------------------------------------------- Next.js
const NEXT_PAGE = /^page\.(tsx|ts|jsx|js|mdx|md)$/;
const NEXT_LAYOUT = /^(layout|template|loading|error|not-found|global-error)\.(tsx|ts|jsx|js)$/;

function nextSegment(name) {
  let m;
  if ((m = /^\[\[\.\.\.(.+)\]\]$/.exec(name))) return ':' + m[1] + '*';
  if ((m = /^\[\.\.\.(.+)\]$/.exec(name))) return ':' + m[1] + '+';
  if ((m = /^\[(.+)\]$/.exec(name))) return ':' + m[1];
  try { return decodeURIComponent(name); } catch { return name; }
}

function nextApp(cwd, appDir) {
  const routes = new Map();
  const slots = []; // [pattern, files]
  const walk = (dir, segs, layouts, inSlot) => {
    const entries = ls(dir);
    const here = entries.filter((e) => e.isFile() && NEXT_LAYOUT.test(e.name)).map((e) => join(dir, e.name));
    const chain = [...layouts, ...here];
    const page = entries.find((e) => e.isFile() && NEXT_PAGE.test(e.name));
    const pattern = '/' + segs.join('/');
    if (page) {
      if (inSlot) slots.push([pattern, [join(dir, page.name), ...here]]);
      else routes.set(normPattern(pattern), mkRoute(cwd, pattern, join(dir, page.name), chain, 'next-app'));
    }
    // a slot's default.tsx renders at every URL of its parent that the slot does not match
    const def = entries.find((e) => e.isFile() && /^default\.(tsx|ts|jsx|js)$/.test(e.name));
    if (def && inSlot) slots.push([pattern + '/**', [join(dir, def.name)]]);
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const n = e.name;
      if (n.startsWith('_')) continue; // private folder
      if (/^\((\.{1,3}|\.\.\)\(\.\.)\)/.test(n)) continue; // intercepting route: only on client navigation, the real page is elsewhere
      if (/^\(.*\)$/.test(n)) { walk(join(dir, n), segs, chain, inSlot); continue; } // route group
      if (n.startsWith('@')) { walk(join(dir, n), segs, chain, true); continue; } // parallel route slot
      walk(join(dir, n), [...segs, nextSegment(n)], chain, inSlot);
    }
  };
  walk(appDir, [], [], false);
  // slot pages render inside the page at the same URL
  for (const [p, files] of slots) {
    if (p.endsWith('/**')) {
      const base = normPattern(p.slice(0, -3));
      for (const r of routes.values()) if (r.pattern === base || r.pattern.startsWith(base === '/' ? '/' : base + '/')) for (const f of files) addFile(cwd, r, f);
      continue;
    }
    const r = routes.get(normPattern(p));
    if (r) for (const f of files) addFile(cwd, r, f);
    else routes.set(normPattern(p), { ...mkRoute(cwd, p, files[0], files.slice(1), 'next-app'), slotOnly: true });
  }
  const out = Array.from(routes.values());
  for (const r of out) if (r.dynamic) {
    const v = staticParamsFrom(read(join(cwd, r.file)), 'generateStaticParams');
    if (v) r.values = v;
  }
  return out;
}

function addFile(cwd, r, f) { const x = rel(cwd, f); if (!r.files.includes(x)) r.files.push(x); }

function nextPages(cwd, dir) {
  const globals = ['_app', '_document'].flatMap((n) => ['.tsx', '.ts', '.jsx', '.js'].map((e) => join(dir, n + e))).filter(existsSync);
  const out = [];
  const walk = (d, segs) => {
    for (const e of ls(d)) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!(segs.length === 0 && e.name === 'api')) walk(p, [...segs, nextSegment(e.name)]); continue; }
      if (!/\.(tsx|ts|jsx|js|mdx|md)$/.test(e.name) || /\.(test|spec|d)\./.test(e.name)) continue;
      const name = e.name.replace(/\.[^.]+$/, '');
      if (segs.length === 0 && /^_(app|document|error)$|^(404|500)$/.test(name)) continue;
      const r = mkRoute(cwd, '/' + [...segs, ...(name === 'index' ? [] : [nextSegment(name)])].join('/'), p, globals, 'next-pages');
      if (r.dynamic) { const v = staticParamsFrom(read(p), 'getStaticPaths'); if (v) r.values = v; }
      out.push(r);
    }
  };
  walk(dir, []);
  return out;
}

// generateStaticParams / getStaticPaths / SvelteKit `entries` that return literal values.
export function staticParamsFrom(src, fnName) {
  src = stripComments(src);
  const m = new RegExp('export\\s+(?:async\\s+)?function\\s+' + fnName + '\\b|export\\s+const\\s+' + fnName + '\\b[^=]*=').exec(src);
  if (!m) return null;
  const start = src.indexOf('{', m.index + m[0].length - 1);
  let node = parseExpr(src, m[0].endsWith('=') ? m.index + m[0].length : m.index + m[0].indexOf('function')).node;
  if (node && node.t === 'unknown' && node.first) node = node.first;
  let v = node && node.t === 'fn' ? literal(node.body) : literal(node);
  if (v && !Array.isArray(v) && Array.isArray(v.paths)) v = v.paths.map((p) => p.params || p); // getStaticPaths: { paths: [{ params }] }
  if (start < 0 || !Array.isArray(v) || !v.length || !v.every((x) => x && typeof x === 'object')) return null;
  return v.map((x) => (x.params && typeof x.params === 'object' ? x.params : x));
}

// ------------------------------------------------------------------------------------------- Nuxt
function nuxtSegment(name) {
  return name.replace(/\[\[([^\]]+)\]\]/g, ':$1?').replace(/\[\.\.\.([^\]]+)\]/g, ':$1*').replace(/\[([^\]]+)\]/g, ':$1');
}

function nuxt(cwd) {
  const srcDir = existsSync(join(cwd, 'app', 'pages')) || existsSync(join(cwd, 'app', 'app.vue')) ? join(cwd, 'app') : cwd;
  const pagesDir = join(srcDir, 'pages');
  const globals = [join(srcDir, 'app.vue'), join(srcDir, 'error.vue'), join(srcDir, 'app.config.ts')].filter(existsSync);
  const layoutsDir = join(srcDir, 'layouts');
  const layoutFile = (name) => ['.vue', '.tsx', '.ts'].map((e) => join(layoutsDir, name + e)).find(existsSync);
  if (!isDir(pagesDir)) {
    // no pages/: app.vue is the only page
    return existsSync(join(srcDir, 'app.vue')) ? [mkRoute(cwd, '/', join(srcDir, 'app.vue'), [], 'nuxt')] : [];
  }
  const out = [];
  const walk = (d, segs, parents) => {
    const entries = ls(d);
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (/^\(.*\)$/.test(e.name)) { walk(p, segs, parents); continue; }
        // foo/ next to foo.vue: foo.vue wraps its children (<NuxtPage>)
        const wrapper = entries.find((x) => x.isFile() && x.name.replace(/\.(vue|tsx|ts|jsx|js)$/, '') === e.name);
        walk(p, [...segs, nuxtSegment(e.name)], wrapper ? [...parents, join(d, wrapper.name)] : parents);
        continue;
      }
      if (!/\.(vue|tsx|jsx)$/.test(e.name)) continue;
      const name = e.name.replace(/\.[^.]+$/, '');
      const src = read(p);
      const meta = /definePageMeta\s*\(/.exec(src);
      let pattern = '/' + [...segs, ...(name === 'index' ? [] : [nuxtSegment(name)])].join('/');
      let layout = 'default';
      if (meta) {
        const o = parseExpr(src, meta.index + meta[0].length).node;
        if (o && o.t === 'obj') {
          if (o.props.path && o.props.path.t === 'str') pattern = o.props.path.v.replace(/\(\.\*\)\*?/g, '*');
          if (o.props.layout && o.props.layout.t === 'str') layout = o.props.layout.v;
          if (o.props.layout && o.props.layout.t === 'bool' && !o.props.layout.v) layout = null;
        }
      }
      const lf = layout && layoutFile(layout);
      const r = mkRoute(cwd, pattern, p, [...parents, ...(lf ? [lf] : []), ...globals], 'nuxt');
      if (meta) { const g = guardsFrom(src.slice(meta.index, meta.index + 800)); if (g.length) r.guards = g; }
      out.push(r);
    }
  };
  walk(pagesDir, [], []);
  return out;
}

// ------------------------------------------------------------------------------------- SvelteKit
function svelteSegment(name) {
  return name.replace(/\[\[([^\]=]+)(=[^\]]+)?\]\]/g, ':$1?').replace(/\[\.\.\.([^\]=]+)(=[^\]]+)?\]/g, ':$1*').replace(/\[([^\]=]+)(=[^\]]+)?\]/g, ':$1');
}

function sveltekit(cwd) {
  let routesDir = join(cwd, 'src', 'routes');
  const cfg = read(join(cwd, 'svelte.config.js'));
  const m = /routes\s*:\s*['"]([^'"]+)['"]/.exec(cfg);
  if (m) routesDir = resolve(cwd, m[1]);
  const globals = [join(cwd, 'src', 'app.html'), ...['ts', 'js'].map((e) => join(cwd, 'src', 'hooks.client.' + e)), ...['ts', 'js'].map((e) => join(cwd, 'src', 'hooks.server.' + e))].filter(existsSync);
  const out = [];
  const walk = (d, segs, layouts) => {
    const entries = ls(d);
    const here = entries.filter((e) => e.isFile() && /^\+(layout|error)(@[^.]*)?(\.server)?\.(svelte|ts|js)$/.test(e.name)).map((e) => join(d, e.name));
    const chain = [...layouts, ...here];
    const pages = entries.filter((e) => e.isFile() && /^\+page(@[^.]*)?(\.server)?\.(svelte|ts|js)$/.test(e.name)).map((e) => join(d, e.name));
    if (pages.some((p) => p.endsWith('.svelte'))) {
      const main = pages.find((p) => p.endsWith('.svelte'));
      const r = mkRoute(cwd, '/' + segs.join('/'), main, [...pages.filter((p) => p !== main), ...chain, ...globals], 'sveltekit');
      if (r.dynamic) for (const p of pages) { const v = staticParamsFrom(read(p), 'entries'); if (v) { r.values = v; break; } }
      out.push(r);
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (/^\(.*\)$/.test(e.name)) walk(join(d, e.name), segs, chain);
      else walk(join(d, e.name), [...segs, svelteSegment(e.name)], chain);
    }
  };
  walk(routesDir, [], []);
  return out;
}

// ------------------------------------------------------------------------------------------ Astro
function astro(cwd) {
  const pagesDir = join(cwd, 'src', 'pages');
  const out = [];
  const walk = (d, segs) => {
    for (const e of ls(d)) {
      if (e.name.startsWith('_')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { walk(p, [...segs, svelteSegment(e.name)]); continue; }
      if (!/\.(astro|md|mdx|markdown|html)$/.test(e.name)) continue; // .ts/.js are endpoints
      const name = e.name.replace(/\.[^.]+$/, '');
      const r = mkRoute(cwd, '/' + [...segs, ...(name === 'index' ? [] : [svelteSegment(name)])].join('/'), p, [], 'astro');
      if (r.dynamic) {
        const src = read(p);
        const v = staticParamsFrom(src.replace(/^---|---$/gm, ''), 'getStaticPaths');
        if (v) r.values = v;
        else {
          // getStaticPaths() over a content collection: the entries' ids are the values
          const c = /getCollection\(\s*['"]([\w-]+)['"]/.exec(src);
          if (c && r.params.length === 1) {
            const dir = [join(cwd, 'src', 'content', c[1]), join(cwd, 'src', 'data', c[1])].find(isDir);
            if (dir) r.values = listContent(dir).map((id) => ({ [r.params[0]]: id }));
          }
        }
      }
      out.push(r);
    }
  };
  walk(pagesDir, []);
  return out;
}

function listContent(dir, prefix = '') {
  const out = [];
  for (const e of ls(dir)) {
    if (e.isDirectory()) out.push(...listContent(join(dir, e.name), prefix + e.name + '/'));
    else if (/\.(md|mdx|mdoc|json|ya?ml)$/.test(e.name) && !e.name.startsWith('_')) out.push(prefix + e.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '-'));
  }
  return out;
}

// ------------------------------------------------------------------- React Router 7 / Remix
function reactRouterApp(cwd, aliases) {
  const cfg = read(join(cwd, 'react-router.config.ts')) || read(join(cwd, 'react-router.config.js'));
  const m = /appDirectory\s*:\s*['"]([^'"]+)['"]/.exec(cfg);
  const appDir = join(cwd, m ? m[1] : 'app');
  const root = ['root.tsx', 'root.jsx', 'root.ts', 'root.js'].map((f) => join(appDir, f)).find(existsSync);
  const routesFile = ['routes.ts', 'routes.js', 'routes.tsx'].map((f) => join(appDir, f)).find(existsSync);
  if (!routesFile) return remixFlat(cwd, join(appDir, 'routes'), root ? [root] : []);
  const src = stripComments(read(routesFile));
  const decl = declarations(src);
  if (decl.default === undefined) return [];
  const out = [];
  const visit = (node, prefix, layouts) => {
    if (!node) return;
    if (node.t === 'arr') { for (const it of node.items) visit(it.t === 'spread' ? it.arg : it, prefix, layouts); return; }
    if (node.t === 'unknown' && node.first) return visit(node.first, prefix, layouts);
    if (node.t !== 'call') return;
    const fn = node.callee.t === 'id' ? node.callee.name.split('.').pop() : '';
    const a = node.args;
    const file = (n) => (n && n.t === 'str' ? join(appDir, n.v) : null);
    const kids = (n) => n && n.t === 'arr' ? n : null;
    if (fn === 'index') { const f = file(a[0]); if (f && hasDefault(f)) out.push(mkRoute(cwd, prefix || '/', f, layouts, 'react-router')); return; }
    if (fn === 'route') {
      const path = a[0] && a[0].t === 'str' ? a[0].v : '';
      const f = file(a[1]);
      const children = kids(a[2]) || kids(a[3]);
      const pattern = joinPath(prefix, rrPath(path));
      const before = out.length;
      if (children) visit(children, pattern, f ? [...layouts, f] : layouts);
      const taken = out.slice(before).some((r) => r.pattern === normPattern(pattern));
      if (f && hasDefault(f) && !taken) out.push(mkRoute(cwd, pattern, f, layouts, 'react-router'));
      return;
    }
    if (fn === 'layout') { const f = file(a[0]); visit(kids(a[1]) || kids(a[2]), prefix, f ? [...layouts, f] : layouts); return; }
    if (fn === 'prefix') { visit(kids(a[1]), joinPath(prefix, rrPath(a[0] && a[0].t === 'str' ? a[0].v : '')), layouts); return; }
    if (fn === 'autoRoutes') { out.push(...autoRoutes(cwd, join(appDir, 'routes'), layouts, prefix)); return; }
    if (fn === 'flatRoutes') {
      const o = a[0] && a[0].t === 'obj' ? a[0] : null;
      const dir = o && o.props.rootDirectory && o.props.rootDirectory.t === 'str' ? o.props.rootDirectory.v : 'routes';
      out.push(...remixFlat(cwd, join(appDir, dir), layouts, prefix));
    }
  };
  visit(parseExpr(src, decl.default).node, '', root ? [root] : []);
  return out;
}

const hasDefault = (f) => /\bexport\s+default\b|\bexport\s*\{[^}]*\bdefault\b/.test(read(f));
function joinPath(a, b) { return b.startsWith('/') ? b : (a || '') + '/' + b; }
// React Router paths: :id, :id?, optional static segments (about?), * splat
function rrPath(p) { return p.split('/').map((s) => (s === '*' ? ':splat*' : s.endsWith('?') && !s.startsWith(':') ? s.slice(0, -1) : s)).join('/'); }

// Remix v2 / @react-router/fs-routes flat routes: concerts.$city.tsx, _index.tsx, _auth.login.tsx, concerts_.mine.tsx, ($lang).tsx, $.tsx
function remixFlat(cwd, routesDir, layouts, prefix = '') {
  const mods = [];
  for (const e of ls(routesDir)) {
    const p = join(routesDir, e.name);
    if (e.isDirectory()) {
      const f = ['route.tsx', 'route.jsx', 'route.ts', 'route.js', 'index.tsx', 'index.jsx'].map((x) => join(p, x)).find(existsSync);
      if (f) mods.push({ id: e.name, file: f });
    } else if (/\.(tsx|jsx|ts|js|mdx|md)$/.test(e.name)) mods.push({ id: e.name.replace(/\.[^.]+$/, ''), file: p });
  }
  // split ids on dots that are not inside [ ] escapes
  const parts = (id) => { const out = []; let cur = '', esc = false; for (const c of id) { if (c === '[') esc = true; else if (c === ']') esc = false; else if (c === '.' && !esc) { out.push(cur); cur = ''; continue; } cur += c; } out.push(cur); return out; };
  const byId = new Map(mods.map((m) => [m.id, m]));
  const out = [];
  for (const m of mods) {
    const segs = parts(m.id);
    const url = [];
    for (const s of segs) {
      let x = s.replace(/_$/, '');
      if (x === '_index' || x.startsWith('_')) continue; // index or pathless layout
      if (x === '$') x = ':splat*';
      else if (/^\(\$(.+)\)$/.test(x)) x = ':' + x.slice(2, -1) + '?';
      else if (/^\((.+)\)$/.test(x)) x = x.slice(1, -1); // optional static segment: take the present form
      else if (x.startsWith('$')) x = ':' + x.slice(1);
      x = x.replace(/[[\]]/g, '');
      url.push(x);
    }
    // parent layouts: every prefix of the id that is a module itself (unless the segment ends with _)
    const chain = [];
    for (let i = 1; i < segs.length; i++) {
      if (segs[i - 1].endsWith('_')) { chain.length = 0; continue; }
      const pid = segs.slice(0, i).join('.');
      if (byId.has(pid)) chain.push(byId.get(pid).file);
    }
    const last = segs[segs.length - 1];
    const isLayoutOnly = last.startsWith('_') && last !== '_index' && mods.some((o) => o.id.startsWith(m.id + '.'));
    if (isLayoutOnly || !hasDefault(m.file)) continue; // pathless layout, or a resource route (loader only)
    // a parent route with an _index child is reached through the child
    if (last !== '_index' && byId.has(m.id + '._index')) continue;
    out.push(mkRoute(cwd, joinPath(prefix, url.join('/')), m.file, [...layouts, ...chain], 'remix-flat'));
  }
  return out;
}

// react-router-auto-routes (folders are segments too): users/$username/notes/_layout.tsx, index.tsx,
// _auth/ pathless folders, +shared/ colocated folders, *.server.* / *.test.* ignored.
function remixSeg(x) {
  x = x.replace(/_$/, '');
  if (x === '$') return ':splat*';
  if (/^\(\$(.+)\)$/.test(x)) return ':' + x.slice(2, -1) + '?';
  if (/^\((.+)\)$/.test(x)) return x.slice(1, -1);
  if (x.startsWith('$')) return ':' + x.slice(1);
  return x.replace(/[[\]]/g, '');
}
function autoRoutes(cwd, dir, layouts, prefix = '', segs = []) {
  const out = [];
  const entries = ls(dir);
  const layout = entries.find((e) => e.isFile() && /^_layout\.(tsx|jsx|ts|js)$/.test(e.name));
  const chain = layout ? [...layouts, join(dir, layout.name)] : layouts;
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name.startsWith('+') || e.name.startsWith('.')) continue;
      const parts = e.name.startsWith('_') ? [] : e.name.split('.').map(remixSeg);
      out.push(...autoRoutes(cwd, p, chain, prefix, [...segs, ...parts]));
      continue;
    }
    if (!/\.(tsx|jsx|ts|js|mdx|md)$/.test(e.name) || /\.(server|client|test|spec)\./.test(e.name) || /^_layout\./.test(e.name)) continue;
    if (!hasDefault(p)) continue; // resource route
    const parts = e.name.replace(/\.[^.]+$/, '').split('.').filter((x) => x !== 'index' && !x.startsWith('_')).map(remixSeg);
    out.push(mkRoute(cwd, joinPath(prefix, [...segs, ...parts].join('/')), p, chain, 'auto-routes'));
  }
  return out;
}

// ------------------------------------------------------------------------------ TanStack Router
function tanstack(cwd) {
  const cfg = (() => { try { return JSON.parse(read(join(cwd, 'tsr.config.json'))); } catch { return {}; } })();
  const routesDir = join(cwd, cfg.routesDirectory || 'src/routes');
  const gen = join(cwd, cfg.generatedRouteTree || 'src/routeTree.gen.ts');
  const root = ['__root.tsx', '__root.jsx', '__root.ts'].map((f) => join(routesDir, f)).find(existsSync);
  const conv = (p) => p.replace(/\{-\$([\w]+)\}/g, ':$1?').replace(/\/\$$/, '/:_splat*').replace(/^\$$/, ':_splat*').replace(/\$([\w]+)/g, ':$1');
  // the generated tree is only trusted when it is newer than every route file (the dev server or build rewrites it)
  const newest = (d) => { let t = 0; for (const e of ls(d)) { const p = join(d, e.name); t = Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs); } return t; };
  const src = existsSync(gen) && statSync(gen).mtimeMs >= newest(routesDir) ? read(gen) : '';
  if (src) {
    // the generated tree lists every full path and the file it comes from
    const files = {};
    for (const m of src.matchAll(/import\s*\{\s*Route\s+as\s+(\w+)\s*\}\s*from\s*['"]([^'"]+)['"]/g)) files[m[1]] = m[2];
    const block = /interface\s+FileRoutesByFullPath\s*\{([\s\S]*?)\n\}/.exec(src);
    const parent = {};
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(\w+)\.update\(\s*\{[\s\S]*?getParentRoute\s*:\s*\(\)\s*=>\s*(\w+)/g)) parent[m[1]] = m[3];
    const fileOf = (id) => { id = id.replace(/WithChildren$/, ''); const imp = files[id] || files[id + 'Import']; return imp ? resolveImport(imp, gen, cwd, []) : null; };
    if (block) {
      const out = [];
      const entries = Array.from(block[1].matchAll(/['"]([^'"]+)['"]\s*:\s*typeof\s+(\w+)/g));
      // index routes ('/posts/') before their layout ('/posts'), so the page file is the index
      entries.sort((a, b) => (b[1].endsWith('/') ? 1 : 0) - (a[1].endsWith('/') ? 1 : 0));
      for (const m of entries) {
        const f = fileOf(m[2]);
        const chain = [];
        for (let p = parent[m[2].replace(/WithChildren$/, '')], i = 0; p && i < 20; p = parent[p], i++) { const pf = fileOf(p); if (pf) chain.push(pf); }
        if (root && !chain.includes(root)) chain.push(root);
        out.push(mkRoute(cwd, conv(m[1]).replace(/\/$/, '') || '/', f, chain, 'tanstack-generated'));
      }
      return dedupe(out);
    }
  }
  // file-based, without the generated tree
  const out = [];
  const walk = (d, segs, layouts) => {
    for (const e of ls(d)) {
      if (e.name.startsWith('-') || e.name.startsWith('__root')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) {
        const s = /^\(.*\)$/.test(e.name) ? null : e.name;
        const layout = ['route.tsx', 'route.jsx'].map((x) => join(p, x)).find(existsSync);
        walk(p, s ? [...segs, ...s.split('.')] : segs, layout ? [...layouts, layout] : layouts);
        continue;
      }
      if (!/\.(tsx|jsx)$/.test(e.name) || /\.lazy\./.test(e.name)) continue;
      const name = e.name.replace(/\.[^.]+$/, '');
      if (name === 'route' && ls(d).some((x) => x.name.startsWith('index.'))) continue;
      const parts = name === 'index' || name === 'route' ? [] : name.split('.').filter((x) => x !== 'index');
      const url = [...segs, ...parts].filter((s) => !s.startsWith('_')).map((s) => s.replace(/_$/, ''));
      out.push(mkRoute(cwd, conv('/' + url.join('/')), p, [...layouts, ...(root ? [root] : [])], 'tanstack'));
    }
  };
  walk(routesDir, [], []);
  return dedupe(out);
}

// ------------------------------------------------------------------------------- config arrays
// Reads a route array (Angular Routes, Vue Router routes, React Router objects) from a file,
// following identifiers to declarations in the same file and imports, and lazy children.
function makeReader(cwd, aliases) {
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) { const src = stripComments(read(file)); cache.set(file, { src, decl: declarations(src), names: declaredNames(src), imports: importMap(src) }); }
    return cache.get(file);
  };
  // resolve an identifier to { file, node }
  const deref = (file, node, depth = 0) => {
    if (!node || depth > 6) return null;
    if (node.t !== 'id') return { file, node };
    const m = load(file);
    const name = node.name.split('.')[0];
    if (m.decl[name] !== undefined) return deref(file, parseExpr(m.src, m.decl[name]).node, depth + 1);
    const imp = m.imports[name];
    if (imp) {
      const f = resolveImport(imp.from, file, cwd, aliases);
      if (!f) return null;
      const t = load(f);
      const key = imp.name === 'default' ? 'default' : imp.name;
      if (t.decl[key] !== undefined) return deref(f, parseExpr(t.src, t.decl[key]).node, depth + 1);
    }
    return null;
  };
  // the file a component reference points to (identifier import, lazy import(), JSX element)
  const componentFile = (file, node) => {
    if (!node) return null;
    if (node.t === 'id') { const imp = load(file).imports[node.name.split('.')[0]]; return imp ? resolveImport(imp.from, file, cwd, aliases) : (load(file).decl[node.name] !== undefined || load(file).names.has(node.name) ? file : null); }
    if (node.t === 'fn' || node.t === 'import') { const spec = node.t === 'import' ? node.spec : node.imports[0]; return spec ? resolveImport(spec, file, cwd, aliases) : null; }
    if (node.t === 'jsx') return componentFile(file, { t: 'id', name: node.name });
    if (node.t === 'call' && node.callee.t === 'id' && /lazy|defineAsyncComponent/.test(node.callee.name)) return componentFile(file, node.args[0]);
    if (node.t === 'unknown' && node.first) return componentFile(file, node.first);
    return null;
  };
  return { load, deref, componentFile };
}

function guardsFrom(text) {
  const out = [];
  const add = (k, v) => { v = v.replace(/\s+/g, ' ').trim(); if (v && v !== '[]' && v !== '{}') out.push(k + ': ' + (v.length > 60 ? v.slice(0, 57) + '…' : v)); };
  for (const m of text.matchAll(/\b(canActivate|canMatch|canActivateChild|middleware|beforeEnter)\s*:\s*(\[[^\]]*\]|['"][^'"]+['"]|[\w.]+)/g)) add(m[1], m[2]);
  for (const m of text.matchAll(/\b(roles?|requiresAuth|requiresAdmin|permissions?|authorize)\s*:\s*(\[[^\]]*\]|['"][^'"]+['"]|true|[\w.]+)/g)) add(m[1], m[2]);
  return out;
}

function configRoutes(cwd, aliases, file, startNode, kind) {
  const R = makeReader(cwd, aliases);
  const out = [];
  const seen = new Set();
  const visitArr = (f, node, prefix, layouts, guards, depth) => {
    const d = R.deref(f, node);
    if (!d || depth > 12) return;
    if (d.node.t === 'call') {
      // RouterModule.forChild(routes), provideRouter(routes, …), createBrowserRouter(routes)
      return visitArr(d.file, d.node.args[0], prefix, layouts, guards, depth + 1);
    }
    if (d.node.t !== 'arr') return;
    for (const it of d.node.items) {
      if (it.t === 'spread') { visitArr(d.file, it.arg, prefix, layouts, guards, depth + 1); continue; }
      const o = R.deref(d.file, it);
      if (!o || o.node.t !== 'obj') continue;
      visitObj(o.file, o.node, prefix, layouts, guards, depth);
    }
  };
  const str = (n) => (n && n.t === 'str' ? n.v : null);
  const visitObj = (f, o, prefix, layouts, guards, depth) => {
    const p = o.props;
    for (const s of o.spreads) { const x = R.deref(f, s); if (x && x.node.t === 'obj') { Object.assign(p, { ...x.node.props, ...p }); } }
    if (p.redirectTo || p.redirect) return; // not a page
    let path = str(p.path);
    if (path === null && !(p.index && p.index.t === 'bool')) path = p.matcher ? null : '';
    if (path === null) return;
    if (path === '**' || /^\/?:pathMatch\(/.test(path) || path === '*' && kind !== 'react-router') return; // wildcard: the 404 page
    const full = path.startsWith('/') ? path : joinPath(prefix, path);
    const pattern = kind === 'react-router' ? rrPath(full) : vuePath(full);
    const g = [...guards, ...guardsFrom(objText(p))];
    const comp = R.componentFile(f, p.component || p.Component || p.element || p.loadComponent || p.lazy || (p.components && p.components.t === 'obj' && p.components.props.default));
    const children = p.children;
    const lazyKids = p.loadChildren;
    if (comp) {
      const key = pattern + '|' + comp;
      // a parent with children is a layout; it is a page of its own only if nothing below takes its path
      if (!seen.has(key)) { seen.add(key); out.push({ ...mkRoute(cwd, pattern, comp, layouts, kind), ...(g.length ? { guards: g } : {}), parentOf: children || lazyKids ? true : undefined }); }
    }
    const nextLayouts = comp ? [...layouts, comp] : layouts;
    if (children) visitArr(f, children, full, nextLayouts, g, depth + 1);
    if (lazyKids) {
      const spec = lazyKids.t === 'fn' ? lazyKids.imports[0] : lazyKids.t === 'str' ? lazyKids.v.split('#')[0] : null;
      const target = spec && resolveImport(spec, f, cwd, aliases);
      if (target) {
        const t = R.load(target);
        const exp = lazyKids.t === 'fn' ? /\.then\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.(\w+)/.exec(lazyKids.raw) : null;
        let start = exp && t.decl[exp[2]] !== undefined ? t.decl[exp[2]] : t.decl.default;
        let node = start !== undefined ? parseExpr(t.src, start).node : null;
        if (!node) { const fc = /RouterModule\.forChild\s*\(/.exec(t.src); if (fc) node = parseExpr(t.src, fc.index + fc[0].length).node; }
        if (node) visitArr(target, node, full, nextLayouts, g, depth + 1);
      }
    }
  };
  visitArr(file, startNode, '', [], [], 0);
  // a layout route whose children include an index ('' path) is reached through that child
  return dedupe(out.filter((r) => !(r.parentOf && out.some((c) => c !== r && c.pattern === r.pattern && c.files.includes(r.file)))));
}

function objText(props) { return Object.entries(props).filter(([k]) => /canActivate|canMatch|beforeEnter|meta|data|middleware/.test(k)).map(([k, v]) => k + ': ' + nodeText(v)).join(', '); }
function nodeText(n) {
  if (!n) return '';
  if (n.t === 'str') return JSON.stringify(n.v);
  if (n.t === 'id') return n.name;
  if (n.t === 'bool' || n.t === 'num') return String(n.v);
  if (n.t === 'arr') return '[' + n.items.map(nodeText).join(', ') + ']';
  if (n.t === 'obj') return '{ ' + Object.entries(n.props).map(([k, v]) => k + ': ' + nodeText(v)).join(', ') + ' }';
  if (n.t === 'call') return nodeText(n.callee) + '()';
  return '';
}
// Vue Router / Angular paths: :id(\\d+) → :id, :id? :id+ :id* kept
function vuePath(p) { return p.replace(/:([\w$]+)\((?:[^()]|\([^()]*\))*\)([?+*]?)/g, ':$1$2'); }

const SRC_EXT = /\.(tsx|ts|jsx|js|mjs|vue)$/;
function sourceFiles(cwd, dirs, max = 4000) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 10 || out.length >= max) return;
    for (const e of ls(d)) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!/^(dist|build|out|coverage|public|static|assets|__tests__|test|tests|e2e)$/.test(e.name)) walk(p, depth + 1); }
      else if (SRC_EXT.test(e.name) && !/\.(test|spec|stories|d)\./.test(e.name)) out.push(p);
    }
  };
  for (const d of dirs) if (isDir(join(cwd, d))) walk(join(cwd, d), 0);
  return out;
}

function angular(cwd, aliases) {
  const files = sourceFiles(cwd, ['src', 'projects']);
  for (const f of files) {
    const src = stripComments(read(f));
    const m = /\b(provideRouter|RouterModule\.forRoot)\s*\(/.exec(src);
    if (!m) continue;
    const node = parseExpr(src, m.index + m[0].length).node;
    const routes = configRoutes(cwd, aliases, f, node, 'angular');
    if (routes.length || node) return routes;
  }
  // routes declared but provided elsewhere: app.routes.ts
  const ar = files.find((f) => /app\.routes\.ts$|app-routing\.module\.ts$/.test(f));
  if (ar) {
    const src = stripComments(read(ar));
    const d = declarations(src);
    const name = Object.keys(d).find((k) => /routes/i.test(k));
    if (name) return configRoutes(cwd, aliases, ar, { t: 'id', name }, 'angular');
  }
  return [];
}

function vueRouter(cwd, aliases) {
  const files = sourceFiles(cwd, ['src']);
  for (const f of files) {
    const src = stripComments(read(f));
    const m = /\b(createRouter|new\s+(?:VueRouter|Router))\s*\(/.exec(src);
    if (!m) continue;
    const opts = parseExpr(src, m.index + m[0].length).node;
    if (!opts || opts.t !== 'obj' || !opts.props.routes) {
      // unplugin-vue-router: routes come from src/pages
      if (/vue-router\/auto|unplugin-vue-router|vue-router\/auto-routes/.test(src)) return fileBasedVue(cwd);
      continue;
    }
    if (/vue-router\/auto-routes/.test(src)) return fileBasedVue(cwd);
    const routes = configRoutes(cwd, aliases, f, opts.props.routes, 'vue-router');
    // createWebHashHistory(): every route lives in the URL's hash (/#/users)
    if (/\bcreateWebHashHistory\s*\(/.test(src)) for (const r of routes) r.hash = true;
    return routes;
  }
  return [];
}

function fileBasedVue(cwd) {
  const pagesDir = join(cwd, 'src', 'pages');
  const out = [];
  const walk = (d, segs, parents) => {
    const entries = ls(d);
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (/^\(.*\)$/.test(e.name)) { walk(p, segs, parents); continue; }
        const wrapper = entries.find((x) => x.isFile() && x.name === e.name + '.vue');
        walk(p, [...segs, nuxtSegment(e.name)], wrapper ? [...parents, join(d, wrapper.name)] : parents);
        continue;
      }
      if (!e.name.endsWith('.vue')) continue;
      const name = e.name.replace(/\.vue$/, '');
      out.push(mkRoute(cwd, '/' + [...segs, ...(name === 'index' ? [] : [nuxtSegment(name)])].join('/'), p, parents, 'vue-router-files'));
    }
  };
  walk(pagesDir, [], []);
  return out;
}

function reactRouterLib(cwd, aliases) {
  const files = sourceFiles(cwd, ['src', 'app']);
  let out = [];
  // Hash or browser routing. With only a hash router in the source (<HashRouter> in main.tsx, <Routes> in
  // App.tsx), every route is a hash route. With both, the hash router's routes are left out: which router the
  // app mounts can't be told from the source, and a second, unused router (a demo entry, an old file) must not
  // make pages get checked twice (/dashboard and /#/dashboard) or at URLs the app doesn't serve. The route
  // table read from the running app's router adds whatever this leaves out.
  let hashAny = false, browserAny = false;
  for (const f of files) {
    const raw = read(f);
    if (!/react-router/.test(raw)) continue;
    const src = stripComments(raw);
    const fileHash = /<HashRouter\b|\bcreateHashRouter\s*\(/.test(src);
    if (fileHash) hashAny = true;
    if (/<BrowserRouter\b|\bcreateBrowserRouter\s*\(/.test(src)) browserAny = true;
    const tag = (rs, h) => rs.map((r) => ({ ...r, _hash: h }));
    for (const m of src.matchAll(/\b(createBrowserRouter|createHashRouter|createMemoryRouter|useRoutes)\s*\(/g)) {
      const h = m[1] === 'createHashRouter' || (m[1] !== 'createBrowserRouter' && fileHash);
      out.push(...tag(configRoutes(cwd, aliases, f, parseExpr(src, m.index + m[0].length).node, 'react-router'), h));
    }
    // <Routes><Route path="…" element={<Page/>}>…</Route></Routes>
    const R = makeReader(cwd, aliases);
    const visit = (el, prefix, layouts) => {
      if (el.name !== 'Route') { for (const c of el.children) visit(c, prefix, layouts); return; }
      const a = el.attrs;
      const path = a.path && a.path.t === 'str' ? a.path.v : a.index ? '' : null;
      const full = path === null ? prefix : path.startsWith('/') ? path : joinPath(prefix, path);
      const comp = R.componentFile(f, a.element || a.Component || a.component || a.lazy);
      if (comp && (path !== null)) {
        const isLayout = el.children.length > 0;
        if (!isLayout || el.children.every((c) => !(c.attrs.index || (c.attrs.path && c.attrs.path.t === 'str' && c.attrs.path.v === '')))) {
          if (!isLayout || path !== null) out.push({ ...mkRoute(cwd, rrPath(full), comp, layouts, 'react-router-jsx'), ...(isLayout ? { parentOf: true } : {}), _hash: fileHash });
        }
      }
      for (const c of el.children) visit(c, path === null ? prefix : full, comp ? [...layouts, comp] : layouts);
    };
    for (const el of jsxElementsIn(src, ['Routes'])) visit(el, '', []);
  }
  if (hashAny && browserAny) out = out.filter((r) => !r._hash);
  const res = dedupe(out.filter((r) => !(r.parentOf && out.some((c) => c !== r && c.pattern === r.pattern))));
  for (const r of res) {
    if (hashAny && !browserAny) r.hash = true;
    delete r._hash;
  }
  return res;
}

function dedupe(routes) {
  const m = new Map();
  for (const r of routes) {
    const o = m.get(r.pattern);
    if (!o) { m.set(r.pattern, r); continue; }
    for (const f of r.files) if (!o.files.includes(f)) o.files.push(f);
    if (r.guards) o.guards = [...new Set([...(o.guards || []), ...r.guards])];
  }
  return Array.from(m.values());
}

// ------------------------------------------------------------------------------------- endpoints
// Server endpoints of the same project (Next route handlers and pages/api, SvelteKit +server, Nuxt
// server/api and server/routes, Astro .ts pages): a page that fetches one renders what its code returns.
export function discoverEndpoints(cwd, framework = detectRouting(cwd)) {
  const out = [];
  const walk = (dir, segs, test, seg = (n) => n) => {
    for (const e of ls(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p, /^\(.*\)$/.test(e.name) || e.name.startsWith('@') ? segs : [...segs, seg(e.name)], test, seg); continue; }
      const name = test(e.name);
      if (name !== null) out.push(mkRoute(cwd, '/' + [...segs, ...(name ? [seg(name)] : [])].join('/'), p, [], 'endpoint'));
    }
  };
  if (framework === 'next') {
    for (const d of ['app', 'src/app']) if (isDir(join(cwd, d))) walk(join(cwd, d), [], (n) => (/^route\.(ts|js|tsx|jsx)$/.test(n) ? '' : null), nextSegment);
    for (const d of ['pages/api', 'src/pages/api']) if (isDir(join(cwd, d))) walk(join(cwd, d), ['api'], (n) => (/\.(ts|js)$/.test(n) ? n.replace(/\.(ts|js)$/, '').replace(/^index$/, '') : null), nextSegment);
  } else if (framework === 'sveltekit') {
    walk(join(cwd, 'src', 'routes'), [], (n) => (/^\+server\.(ts|js)$/.test(n) ? '' : null), svelteSegment);
  } else if (framework === 'nuxt') {
    walk(join(cwd, 'server', 'api'), ['api'], (n) => (/\.(ts|js)$/.test(n) ? n.replace(/(\.(get|post|put|patch|delete))?\.(ts|js)$/, '').replace(/^index$/, '') : null), nuxtSegment);
    walk(join(cwd, 'server', 'routes'), [], (n) => (/\.(ts|js)$/.test(n) ? n.replace(/(\.(get|post|put|patch|delete))?\.(ts|js)$/, '').replace(/^index$/, '') : null), nuxtSegment);
  } else if (framework === 'astro') {
    walk(join(cwd, 'src', 'pages'), [], (n) => (/\.(ts|js)$/.test(n) ? n.replace(/\.(ts|js)$/, '').replace(/^index$/, '') : null), svelteSegment);
  }
  return out;
}

// ------------------------------------------------------------------------------------- manifests
// Build output lists the instances a build prerendered (generateStaticParams, prerender entries).
export function manifestInstances(cwd) {
  const urls = [];
  const notes = [];
  const pre = join(cwd, '.next', 'prerender-manifest.json');
  if (existsSync(pre)) {
    try {
      const j = JSON.parse(read(pre));
      for (const [u, v] of Object.entries(j.routes || {})) if (!/\.(rsc|json|txt|xml|ico|png|svg)$|^\/_/.test(u) && !(v && v.dataRoute === null && /\/_not-found/.test(u))) urls.push(u);
      notes.push(`.next/prerender-manifest.json: ${urls.length} prerendered URL(s)`);
    } catch { /* unreadable */ }
  }
  // Nuxt generate / SvelteKit / Astro builds: one index.html per prerendered page
  for (const dir of ['.output/public', 'build', '.svelte-kit/output/prerendered/pages', 'dist']) {
    const base = join(cwd, dir);
    if (!isDir(base) || (dir === 'dist' && !existsSync(join(cwd, 'astro.config.mjs')) && !existsSync(join(cwd, 'astro.config.ts')))) continue;
    const n = urls.length;
    const walk = (d, depth) => {
      if (depth > 8 || urls.length > 20000) return;
      for (const e of ls(d)) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (!/^(_nuxt|_app|_astro|assets|_next)$/.test(e.name)) walk(p, depth + 1); }
        else if (e.name.endsWith('.html') && !/^(404|200|500)\.html$/.test(e.name)) urls.push('/' + rel(base, p).replace(/(^|\/)index\.html$/, '').replace(/\.html$/, ''));
      }
    };
    walk(base, 0);
    if (urls.length > n) notes.push(`${dir}/: ${urls.length - n} prerendered page(s)`);
  }
  return { urls: Array.from(new Set(urls.map((u) => normPattern(u)))), notes };
}

// ------------------------------------------------------------------------------------------ entry
export function detectRouting(cwd) {
  const deps = pkgDeps(cwd);
  if (deps.next) return 'next';
  if (deps.nuxt) return 'nuxt';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.astro) return 'astro';
  if (deps['@react-router/dev'] || deps['@remix-run/dev'] || deps['@remix-run/react']) return 'react-router-app';
  if (deps['@tanstack/react-router'] || deps['@tanstack/solid-router'] || deps['@tanstack/vue-router']) return 'tanstack';
  if (deps['@angular/router'] || deps['@angular/core']) return 'angular';
  if (deps['vue-router'] || deps['unplugin-vue-router']) return 'vue-router';
  if (deps['react-router-dom'] || deps['react-router']) return 'react-router';
  return null;
}

export function discoverRoutes(cwd, { framework } = {}) {
  const fw = framework || detectRouting(cwd);
  const aliases = loadAliases(cwd, fw);
  let routes = [];
  const notes = [];
  if (fw === 'next') {
    for (const d of ['app', 'src/app']) if (isDir(join(cwd, d))) routes.push(...nextApp(cwd, join(cwd, d)));
    for (const d of ['pages', 'src/pages']) if (isDir(join(cwd, d))) routes.push(...nextPages(cwd, join(cwd, d)));
  } else if (fw === 'nuxt') routes = nuxt(cwd);
  else if (fw === 'sveltekit') routes = sveltekit(cwd);
  else if (fw === 'astro') routes = astro(cwd);
  else if (fw === 'react-router-app') routes = reactRouterApp(cwd, aliases);
  else if (fw === 'tanstack') routes = tanstack(cwd);
  else if (fw === 'angular') routes = angular(cwd, aliases);
  else if (fw === 'vue-router') routes = vueRouter(cwd, aliases);
  else if (fw === 'react-router') routes = reactRouterLib(cwd, aliases);
  routes = dedupe(routes).sort((a, b) => (a.dynamic - b.dynamic) || a.pattern.localeCompare(b.pattern));
  const m = manifestInstances(cwd);
  notes.push(...m.notes);
  return { framework: fw, routes, prerendered: m.urls, notes };
}

// URL for a pattern with these param values; null if a required param is missing.
export function fillPattern(pattern, values = {}) {
  let ok = true;
  const out = pattern.replace(/(\/?):([A-Za-z_$][\w$]*)([?+*]?)/g, (_, slash, name, mod) => {
    const v = values[name];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) {
      if (mod === '?' || mod === '*') return '';
      ok = false; return '';
    }
    if (Array.isArray(v)) return slash + v.map((x) => encodeURIComponent(String(x))).join('/');
    return slash + (mod === '+' || mod === '*' ? String(v).split('/').map(encodeURIComponent).join('/') : encodeURIComponent(String(v)));
  });
  return ok ? (out || '/') : null;
}
