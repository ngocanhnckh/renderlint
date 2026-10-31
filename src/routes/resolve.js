// Module resolution for the static import graph: relative paths, tsconfig/jsconfig "paths",
// the aliases frameworks add on their own (Nuxt ~ and @, SvelteKit $lib, Vite @), and
// extension/index lookup. Nothing outside the project (node_modules) is followed.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';

export const CODE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.vue', '.svelte', '.astro', '.mdx', '.md'];
const STYLE_EXT = ['.css', '.scss', '.sass', '.less', '.styl', '.pcss'];
const ALL_EXT = [...CODE_EXT, ...STYLE_EXT, '.json'];

function readJsonc(p) {
  try {
    const txt = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/.*$/gm, '$1').replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(txt);
  } catch { return null; }
}

// Aliases from tsconfig.json / jsconfig.json (following "extends" and "references" once) and framework defaults.
export function loadAliases(cwd, framework) {
  const out = [];
  const seen = new Set();
  const visit = (file, depth) => {
    if (depth > 3 || seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const j = readJsonc(file);
    if (!j) return;
    const co = j.compilerOptions || {};
    const base = resolve(dirname(file), co.baseUrl || '.');
    for (const [k, v] of Object.entries(co.paths || {})) {
      const targets = (Array.isArray(v) ? v : [v]).map((t) => resolve(base, t));
      out.push({ prefix: k.replace(/\*$/, ''), wildcard: k.endsWith('*'), targets: targets.map((t) => t.replace(/\*$/, '')) });
    }
    if (typeof j.extends === 'string' && j.extends.startsWith('.')) visit(resolve(dirname(file), j.extends.endsWith('.json') ? j.extends : j.extends + '.json'), depth + 1);
    for (const r of j.references || []) if (r && r.path) visit(resolve(dirname(file), r.path.endsWith('.json') ? r.path : join(r.path, 'tsconfig.json')), depth + 1);
  };
  for (const f of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json']) visit(join(cwd, f), 0);
  const add = (prefix, target) => { if (!out.some((a) => a.prefix === prefix)) out.push({ prefix, wildcard: true, targets: [target] }); };
  if (framework === 'nuxt') {
    const src = existsSync(join(cwd, 'app', 'app.vue')) || existsSync(join(cwd, 'app', 'pages')) ? join(cwd, 'app') : cwd;
    add('~~/', cwd + '/'); add('@@/', cwd + '/'); add('~/', src + '/'); add('@/', src + '/');
  }
  if (framework === 'sveltekit') add('$lib/', join(cwd, 'src', 'lib') + '/');
  // Vite projects commonly alias @ to src
  if (existsSync(join(cwd, 'src'))) add('@/', join(cwd, 'src') + '/');
  add('~/', (existsSync(join(cwd, 'app')) ? join(cwd, 'app') : join(cwd, 'src')) + '/');
  return out;
}

function tryFile(p) {
  try { if (statSync(p).isFile()) return p; } catch { /* missing */ }
  for (const e of ALL_EXT) if (existsSync(p + e)) return p + e;
  // TS: import './x.js' that is really x.ts
  const m = /\.(m?js|jsx)$/.exec(p);
  if (m) for (const e of ['.ts', '.tsx', '.mts']) { const q = p.slice(0, -m[0].length) + e; if (existsSync(q)) return q; }
  try { if (statSync(p).isDirectory()) for (const e of ALL_EXT) { const q = join(p, 'index' + e); if (existsSync(q)) return q; } } catch { /* missing */ }
  return null;
}

// Absolute path of the project file `spec` imported from `from`, or null (a package, or not found).
export function resolveImport(spec, from, cwd, aliases) {
  spec = spec.replace(/\?.*$/, '');
  if (spec.startsWith('.')) return tryFile(resolve(dirname(from), spec));
  if (spec.startsWith('/')) {
    // root-relative (Vite: /src/main.ts) or absolute
    return tryFile(join(cwd, spec)) || (isAbsolute(spec) && existsSync(spec) ? spec : null);
  }
  for (const a of aliases) {
    if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix) {
      for (const t of a.targets) {
        const hit = tryFile(a.wildcard ? t + spec.slice(a.prefix.length) : t);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export const rel = (cwd, p) => relative(cwd, p).split('\\').join('/');
