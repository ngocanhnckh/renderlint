// Static import graph of the project's own files, and which routes a change can affect.
//
// buildGraph(cwd, { framework, routes }) reads every route file and follows imports (ES, CommonJS,
// import(), import.meta.glob, CSS @import/@use, Vue/Svelte/Astro blocks, Angular templateUrl/styleUrl,
// Nuxt auto-imported components and composables). Named imports through barrel files (index.ts that
// re-exports) are followed to the module that defines the name, so one barrel does not tie every page
// to every component.
//
// affectedRoutes(graph, changedFiles) answers, for an edit, which routes to re-check:
//   - a file in the app shell (config, entry, root layout, global CSS) → every route
//   - a file some routes import (directly or not) → those routes
//   - a page file that is new or gone → the route set changed: those routes
//   - a code file nothing imports → none (nothing renders it)
//   - anything else (data, content, assets we can't place) → every route, to be safe
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { stripComments } from './jsparse.js';
import { loadAliases, resolveImport, rel } from './resolve.js';

const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const CODE = /\.(tsx?|jsx?|mjs|cjs|mts|vue|svelte|astro|mdx?)$/;
const STYLE = /\.(css|scss|sass|less|styl|pcss)$/;

// Files whose change can affect every page, whatever imports them.
export const GLOBAL_FILES = /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|tsconfig(\.[\w-]+)?\.json|jsconfig\.json|\.env(\.[\w.-]+)?|(next|nuxt|svelte|astro|vite|vitest|tailwind|postcss|webpack|rollup|react-router|remix|angular|uno|windi|babel|tsr)\.config\.[cm]?[jt]s|\.babelrc|\.postcssrc(\.json)?|angular\.json|project\.json|index\.html|app\.html|middleware\.[jt]s|instrumentation\.[jt]s|tsr\.config\.json|components\.json|theme\.json|\.browserslistrc|browserslist)$/;
// Never affect what renders.
const IRRELEVANT = /(^|\/)(README|CHANGELOG|LICENSE)[^/]*$|\.(test|spec|stories|story)\.[cm]?[jt]sx?$|(^|\/)(__tests__|__mocks__|e2e|cypress|playwright|\.storybook|\.github|\.vscode|\.husky|\.renderlint)\/|^docs\//;

// Imports of one file: [{ spec, names: ['A', 'B'] | null (whole module / side effect) }]
export function importsOf(file, src) {
  const ext = extname(file);
  let code = src;
  const out = [];
  if (ext === '.vue' || ext === '.svelte') {
    code = Array.from(src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), (m) => m[1]).join('\n');
    for (const m of src.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/g)) {
      const s = /\bsrc=["']([^"']+)["']/.exec(m[1]);
      if (s) out.push({ spec: s[1], names: null });
      out.push(...cssImports(m[2]));
    }
    for (const m of src.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)) out.push({ spec: m[1], names: null });
  } else if (ext === '.astro') {
    const fm = /^---([\s\S]*?)---/.exec(src);
    code = (fm ? fm[1] : '') + '\n' + Array.from(src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), (m) => m[1]).join('\n');
    for (const m of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) out.push(...cssImports(m[1]));
  } else if (STYLE.test(file)) {
    return cssImports(src);
  } else if (ext === '.md') {
    return [];
  }
  code = stripComments(code);
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s*['"]([^'"]+)['"]/g)) {
    if (/^type\s/.test(m[0].slice(7))) continue;
    out.push({ spec: m[2], names: namedOf(m[1]) });
  }
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[1], names: null });
  for (const m of code.matchAll(/\bexport\s+(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[2], names: m[1].startsWith('*') ? null : namedOf(m[1]), reexport: true });
  for (const m of code.matchAll(/\bimport\s*\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) out.push({ spec: m[1], names: null, lazy: true });
  for (const m of code.matchAll(/\brequire\s*\(\s*['"`]([^'"`$]+)['"`]\s*\)/g)) out.push({ spec: m[1], names: null });
  for (const m of code.matchAll(/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g)) out.push({ spec: m[1], names: null });
  for (const m of code.matchAll(/import\.meta\.glob(?:Eager)?\s*\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g)) {
    for (const g of m[1].matchAll(/['"]([^'"]+)['"]/g)) if (!g[1].startsWith('!')) out.push({ spec: g[1], names: null, glob: true });
  }
  // Angular: templates and styles of a component
  for (const m of code.matchAll(/\b(templateUrl|styleUrl)\s*:\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[2].startsWith('.') ? m[2] : './' + m[2], names: null });
  for (const m of code.matchAll(/\bstyleUrls\s*:\s*\[([^\]]*)\]/g)) for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) out.push({ spec: s[1].startsWith('.') ? s[1] : './' + s[1], names: null });
  return out;
}

function cssImports(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/@(?:import|use|forward|reference)\s+(?:url\()?\s*['"]([^'"]+)['"]/g)) out.push({ spec: m[1], names: null });
  return out;
}

function namedOf(clause) {
  const m = /\{([^}]*)\}/.exec(clause);
  const names = m ? m[1].split(',').map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()).filter(Boolean) : [];
  const def = /^\s*([A-Za-z_$][\w$]*)/.exec(clause);
  if (def && def[1] !== 'type') names.push('default');
  if (/\*\s+as\s/.test(clause)) return null;
  return names.length ? names : null;
}

// A file that only re-exports (barrel): name -> the module(s) it comes from.
function barrelExports(file, src, cwd, aliases) {
  const code = stripComments(src);
  const rest = code.replace(/\bexport\s+(\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"][^'"]+['"];?/g, '').replace(/\bimport\s+[^;]*?from\s*['"][^'"]+['"];?/g, '').trim();
  if (rest.length > 0 && !/^(export\s*\{[^}]*\};?\s*)*$/.test(rest)) return null; // has code of its own
  const map = new Map();
  const star = [];
  for (const m of code.matchAll(/\bexport\s+(\*(?:\s+as\s+(\w+))?|\{([^}]*)\})\s*from\s*['"]([^'"]+)['"]/g)) {
    const target = resolveImport(m[4], file, cwd, aliases);
    if (!target) continue;
    if (m[3] !== undefined) for (const part of m[3].split(',')) { const [a, b] = part.trim().split(/\s+as\s+/); if (a) map.set((b || a).trim(), target); }
    else if (m[2]) map.set(m[2], target);
    else star.push(target);
  }
  return { map, star };
}

function declares(src, name) {
  if (name === 'default') return /\bexport\s+default\b/.test(src);
  return new RegExp('\\bexport\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|class|interface|type|enum)\\s+' + name + '\\b|\\bexport\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}').test(stripComments(src));
}

function expandGlob(spec, from, cwd, aliases) {
  // ./dir/*.ts, ./dir/**/*.vue, /src/pages/**/*.md
  const star = spec.indexOf('*');
  const baseSpec = spec.slice(0, spec.lastIndexOf('/', star) + 1) || './';
  const base = resolveDir(baseSpec, from, cwd, aliases);
  if (!base) return [];
  const re = new RegExp('^' + spec.slice(baseSpec.length).split('**/').map((p) => p.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('(?:.*/)?') + '$');
  const out = [];
  const walk = (d, prefix, depth) => {
    if (depth > 8) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      if (e.isDirectory()) walk(join(d, e.name), prefix + e.name + '/', depth + 1);
      else if (re.test(prefix + e.name)) out.push(join(d, e.name));
    }
  };
  walk(base, '', 0);
  return out;
}
function resolveDir(spec, from, cwd, aliases) {
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  if (spec.startsWith('/')) return join(cwd, spec);
  for (const a of aliases) if (spec.startsWith(a.prefix)) return a.targets[0] + spec.slice(a.prefix.length);
  return null;
}

// Nuxt: components/ and composables/ are auto-imported, by name.
function nuxtAutoImports(cwd) {
  const src = existsSync(join(cwd, 'app', 'components')) || existsSync(join(cwd, 'app', 'pages')) ? join(cwd, 'app') : cwd;
  const comps = new Map(), fns = new Map();
  const walk = (d, prefix, cb) => {
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, [...prefix, e.name], cb); else cb(p, prefix, e.name);
    }
  };
  const pascal = (s) => s.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  walk(join(src, 'components'), [], (p, prefix, name) => {
    if (!/\.(vue|tsx|jsx|ts|js)$/.test(name)) return;
    const base = name.replace(/(\.(client|server))?\.[^.]+$/, '');
    const parts = [...prefix, base === 'index' ? '' : base].filter(Boolean).map(pascal);
    // Nuxt drops a repeated prefix: components/base/BaseButton.vue → BaseButton
    const dedup = parts.filter((x, i) => !(i < parts.length - 1 && parts[parts.length - 1].startsWith(x)));
    comps.set(dedup.join(''), p);
    comps.set(parts.join(''), p);
  });
  for (const dir of ['composables', 'utils']) walk(join(src, dir), [], (p, prefix, name) => {
    if (prefix.length > 0 || !/\.(ts|js|mjs)$/.test(name)) return;
    fns.set(name.replace(/\.[^.]+$/, ''), p);
    for (const m of read(p).matchAll(/export\s+(?:async\s+)?(?:function|const|let)\s+(\w+)/g)) fns.set(m[1], p);
  });
  return { comps, fns };
}

function tagNames(src) {
  const tpl = /<template\b[^>]*>([\s\S]*)<\/template>/.exec(src);
  const out = new Set();
  for (const m of (tpl ? tpl[1] : '').matchAll(/<([A-Za-z][\w-]*)/g)) {
    let n = m[1];
    if (n.includes('-')) n = n.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    if (/^[A-Z]/.test(n)) { out.add(n); if (n.startsWith('Lazy')) out.add(n.slice(4)); }
  }
  return out;
}

export function buildGraph(cwd, { framework, routes = [], entries = [] } = {}) {
  const aliases = loadAliases(cwd, framework);
  const edges = new Map(); // abs file -> Set(abs file)
  const lazy = new Map(); // abs file -> Set(abs file) imported with import(): code-split, loaded by some routes only
  const barrels = new Map();
  const auto = framework === 'nuxt' ? nuxtAutoImports(cwd) : null;
  const barrelOf = (f) => { if (!barrels.has(f)) barrels.set(f, CODE.test(f) ? barrelExports(f, read(f), cwd, aliases) : null); return barrels.get(f); };
  // the file that defines `name` exported by `file`, following re-exports of barrel files; null if unsure
  const definingFile = (file, name, depth) => {
    const b = barrelOf(file);
    if (!b) return depth > 0 ? (declares(read(file), name) ? file : null) : file;
    if (depth > 6) return null;
    if (b.map.has(name)) { const t = b.map.get(name); return barrelOf(t) ? definingFile(t, name, depth + 1) : t; }
    for (const st of b.star) { const hit = definingFile(st, name, depth + 1); if (hit) return hit; }
    return null;
  };
  const visitFile = (file) => {
    if (edges.has(file)) return;
    const set = new Set(), lz = new Set();
    edges.set(file, set); lazy.set(file, lz);
    if (!CODE.test(file) && !STYLE.test(file)) return;
    const src = read(file);
    for (const imp of importsOf(file, src)) {
      if (imp.glob) { for (const f of expandGlob(imp.spec, file, cwd, aliases)) set.add(f); continue; }
      const target = resolveImport(imp.spec, file, cwd, aliases);
      if (!target || target.includes('/node_modules/')) continue;
      if (imp.lazy) lz.add(target);
      // through a barrel: link to the modules that define the imported names
      if (imp.names && !imp.reexport) {
        const defs = imp.names.map((n) => definingFile(target, n, 0));
        if (defs.every(Boolean)) { for (const d of defs) set.add(d); continue; }
      }
      set.add(target);
    }
    if (auto && /\.(vue|tsx|jsx|ts|js)$/.test(file)) {
      for (const t of tagNames(src)) { const f = auto.comps.get(t); if (f && f !== file) set.add(f); }
      for (const m of src.matchAll(/\b(use[A-Z]\w*|[a-z]\w*)\s*\(/g)) { const f = auto.fns.get(m[1]); if (f && f !== file) set.add(f); }
    }
    for (const t of set) visitFile(t);
  };
  const routeFiles = routes.map((r) => r.files.filter(Boolean).map((f) => resolve(cwd, f)));
  for (const fs of routeFiles) for (const f of fs) visitFile(f);
  for (const f of entries) visitFile(resolve(cwd, f));
  // the rest of the source tree too, so "nothing imports this" is a real answer
  const all = projectFiles(cwd);
  for (const f of all) visitFile(f);
  const importers = new Map();
  for (const [f, set] of edges) for (const t of set) { if (!importers.has(t)) importers.set(t, new Set()); importers.get(t).add(f); }
  return { cwd, framework, edges, lazy, importers, routes, routeFiles, entries: entries.map((f) => resolve(cwd, f)), aliases, files: all };
}

const SKIP_DIRS = /^(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.output|\.svelte-kit|\.astro|\.vercel|\.turbo|\.cache|\.renderlint|\.git|\.angular|\.react-router|\.tanstack)$/;
export function projectFiles(cwd, max = 20000) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 12 || out.length >= max) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (SKIP_DIRS.test(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (CODE.test(e.name) || STYLE.test(e.name)) out.push(p);
    }
  };
  walk(cwd, 0);
  return out;
}

// Everything reachable from these files.
export function closure(graph, files, { stop, staticOnly } = {}) {
  const seen = new Set();
  const stack = [...files];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    if (stop && stop.has(f) && !files.includes(f)) continue; // another route's page: not part of this set
    seen.add(f);
    const lz = staticOnly ? graph.lazy.get(f) : null;
    for (const t of graph.edges.get(f) || []) if (!lz || !lz.has(t)) stack.push(t);
  }
  return seen;
}

// Per route: the set of project files it renders with (its page, layouts, and all they import).
// The app shell (entries: main.ts, App.vue, root layouts…) is computed separately: static imports only,
// stopping at route components, so a router that imports pages (eagerly or with import()) doesn't make
// every page part of every route.
export function routeClosures(graph) {
  const pageFiles = new Set(graph.routeFiles.flat());
  const shell = closure(graph, graph.entries, { stop: pageFiles, staticOnly: true });
  const per = graph.routeFiles.map((fs) => closure(graph, fs, { stop: new Set([...pageFiles].filter((p) => !fs.includes(p))) }));
  return { shell, per };
}

// Which routes an edit to `changed` (absolute or project-relative paths) can affect.
export function affectedRoutes(graph, changed, { closures = routeClosures(graph), previousRoutes } = {}) {
  const cwd = graph.cwd;
  const result = { all: false, routes: new Set(), reasons: [] };
  const byFile = new Map(); // file -> route indexes
  closures.per.forEach((set, i) => { for (const f of set) { if (!byFile.has(f)) byFile.set(f, []); byFile.get(f).push(i); } });
  for (const c of changed) {
    const abs = resolve(cwd, c), r = rel(cwd, abs);
    const rendered = closures.shell.has(abs) || byFile.has(abs) || graph.routes.some((x) => x.files.includes(r));
    if (!rendered && IRRELEVANT.test(r)) { result.reasons.push(`${r}: not rendered (test, story, docs)`); continue; }
    if (GLOBAL_FILES.test(r)) { result.all = true; result.reasons.push(`${r}: project configuration → every route`); continue; }
    if (closures.shell.has(abs)) { result.all = true; result.reasons.push(`${r}: part of the app shell → every route`); continue; }
    const hits = byFile.get(abs);
    if (hits && hits.length) {
      for (const i of hits) result.routes.add(i);
      // a file most routes render (root layout, global CSS through it) is reported as such
      result.reasons.push(`${r}: rendered by ${hits.length} route(s)`);
      continue;
    }
    // route files that are new or gone
    if (previousRoutes) {
      const now = graph.routes.findIndex((x) => x.files.includes(r));
      if (now >= 0) { result.routes.add(now); result.reasons.push(`${r}: new route`); continue; }
      if (previousRoutes.some((x) => x.files.includes(r))) { result.reasons.push(`${r}: route removed`); continue; }
    }
    if ((CODE.test(r) || STYLE.test(r)) && existsSync(abs)) { result.reasons.push(`${r}: no page imports it`); continue; }
    if (!existsSync(abs) && (CODE.test(r) || STYLE.test(r))) { result.reasons.push(`${r}: deleted, no page imported it`); continue; }
    if (/^public\//.test(r) || /^static\//.test(r)) {
      // assets served by URL: the routes whose code mentions that URL
      const url = r.replace(/^(public|static)/, '');
      const users = [];
      for (const f of graph.edges.keys()) if (read(f).includes(url)) users.push(f);
      const idx = new Set(users.flatMap((u) => byFile.get(u) || []));
      if (users.some((u) => closures.shell.has(u))) { result.all = true; result.reasons.push(`${r}: used by the app shell → every route`); continue; }
      if (users.length && idx.size) { for (const i of idx) result.routes.add(i); result.reasons.push(`${r}: referenced by ${idx.size} route(s)`); continue; }
      if (!users.length) { result.reasons.push(`${r}: no source mentions ${url}`); continue; }
    }
    result.all = true;
    result.reasons.push(`${r}: can't tell which pages use it (data, content or an asset) → every route`);
  }
  if (result.all) result.routes = new Set(graph.routes.map((_, i) => i));
  return result;
}

// The entry files of the app shell, per framework.
export function shellEntries(cwd, framework) {
  const c = (...ps) => ps.filter((p) => existsSync(join(cwd, p)));
  const src = (...names) => names.flatMap((n) => ['.ts', '.tsx', '.js', '.jsx', '.mjs'].map((e) => n + e));
  switch (framework) {
    case 'next': return c(...src('src/middleware', 'middleware', 'src/instrumentation', 'instrumentation'));
    case 'nuxt': {
      const base = existsSync(join(cwd, 'app', 'app.vue')) || existsSync(join(cwd, 'app', 'pages')) ? 'app/' : '';
      const out = c(base + 'app.vue', base + 'error.vue', ...src(base + 'app.config'));
      for (const d of ['plugins', 'middleware']) {
        try { for (const f of readdirSync(join(cwd, base + d))) if (d === 'plugins' || /\.global\./.test(f)) out.push(base + d + '/' + f); } catch { /* none */ }
      }
      return out;
    }
    case 'sveltekit': return c('src/app.html', ...src('src/hooks.client', 'src/hooks.server', 'src/hooks'));
    case 'astro': return c(...src('src/middleware'));
    case 'react-router-app': return c(...src('app/root', 'app/entry.client', 'app/entry.server'));
    case 'tanstack': return c(...src('src/main', 'src/router', 'src/routes/__root', 'src/client', 'src/ssr'));
    default: return c('index.html', ...src('src/main', 'src/index', 'src/App', 'src/app/app', 'src/app/app.config', 'src/app/app.component', 'src/app/app.module'), 'src/App.vue', 'src/App.svelte');
  }
}

// File state for change detection: path -> mtime:size (cheap) for every project file that can matter.
export function snapshot(cwd) {
  const out = {};
  for (const f of [...projectFiles(cwd), ...otherFiles(cwd)]) { try { const s = statSync(f); out[rel(cwd, f)] = s.mtimeMs + ':' + s.size; } catch { /* gone */ } }
  return out;
}
function otherFiles(cwd) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 8 || out.length > 20000) return;
    let es; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (SKIP_DIRS.test(e.name) || (e.name.startsWith('.') && e.isDirectory())) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (!CODE.test(e.name) && !STYLE.test(e.name) && /\.(json|ya?ml|md|mdx|toml|html|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|env|csv|txt)$|^\.env/.test(e.name)) out.push(p);
    }
  };
  walk(cwd, 0);
  return out;
}
export function diffSnapshots(before, after) {
  const changed = [];
  for (const [f, v] of Object.entries(after)) if (before[f] !== v) changed.push(f);
  for (const f of Object.keys(before)) if (!(f in after)) changed.push(f);
  return changed;
}
export const hashOf = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);
