// Framework / project detection, used for zero-config runs and `renderlint init`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const FRAMEWORKS = [
  { id: 'next', dep: 'next', name: 'Next.js', port: 3000, out: ['out'], preview: (p) => `npx next start -p ${p}` },
  { id: 'nuxt', dep: 'nuxt', name: 'Nuxt', port: 3000, out: ['.output/public', 'dist'], preview: (p) => `npx nuxi preview --port ${p}` },
  { id: 'sveltekit', dep: '@sveltejs/kit', name: 'SvelteKit', port: 5173, out: ['build'], preview: (p) => `npx vite preview --port ${p} --strictPort` },
  { id: 'astro', dep: 'astro', name: 'Astro', port: 4321, out: ['dist'], preview: (p) => `npx astro preview --port ${p}` },
  { id: 'remix', dep: '@remix-run/react', name: 'Remix', port: 5173, out: [], preview: null },
  { id: 'react-router', dep: '@react-router/dev', name: 'React Router', port: 5173, out: ['build/client'], preview: null },
  { id: 'gatsby', dep: 'gatsby', name: 'Gatsby', port: 8000, out: ['public'], preview: (p) => `npx gatsby serve -p ${p}` },
  { id: 'angular', dep: '@angular/core', name: 'Angular', port: 4200, out: ['dist'], preview: null },
  { id: 'qwik', dep: '@builder.io/qwik', name: 'Qwik', port: 5173, out: ['dist'], preview: null },
  { id: 'solid-start', dep: '@solidjs/start', name: 'SolidStart', port: 3000, out: ['.output/public'], preview: null },
  { id: 'cra', dep: 'react-scripts', name: 'Create React App', port: 3000, out: ['build'], preview: null },
  { id: 'vue-cli', dep: '@vue/cli-service', name: 'Vue CLI', port: 8080, out: ['dist'], preview: null },
  { id: 'eleventy', dep: '@11ty/eleventy', name: 'Eleventy', port: 8080, out: ['_site'], preview: null },
  { id: 'parcel', dep: 'parcel', name: 'Parcel', port: 1234, out: ['dist'], preview: null },
  { id: 'vite', dep: 'vite', name: 'Vite', port: 5173, out: ['dist'], preview: (p) => `npx vite preview --port ${p} --strictPort` },
  { id: 'webpack', dep: 'webpack-dev-server', name: 'webpack', port: 8080, out: ['dist'], preview: null },
];

export function detectProject(cwd = process.cwd()) {
  const pkgPath = join(cwd, 'package.json');
  let pkg = null;
  if (existsSync(pkgPath)) { try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); } catch { /* ignore */ } }
  const deps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};
  const fw = FRAMEWORKS.find((f) => deps[f.dep]) || null;
  const scripts = (pkg && pkg.scripts) || {};
  const pm = existsSync(join(cwd, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(cwd, 'yarn.lock')) ? 'yarn'
    : existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock')) ? 'bun' : 'npm';
  const run = (s) => (pm === 'npm' ? `npm run ${s}` : `${pm} ${s}`);
  const staticDirs = ['dist', 'build', 'out', '_site', 'public', '.output/public', 'build/client', 'www']
    .filter((d) => existsSync(join(cwd, d, 'index.html')));
  return {
    pkg, framework: fw, pm, run, scripts,
    devCommand: scripts.dev ? run('dev') : scripts.start && !/next start|node /.test(scripts.start) ? run('start') : null,
    staticDirs,
    hasIndexHtml: existsSync(join(cwd, 'index.html')),
    wordpress: detectWordPress(cwd),
  };
}

// WordPress: a theme (style.css with a "Theme Name:" header), a plugin (a PHP file
// with a "Plugin Name:" header) or a whole site (wp-config.php, wp-content/).
// PHP renders the pages, so renderlint checks the local site's URL; `urls` lists
// where the local environment of this project usually serves it, best guess first.
export function detectWordPress(cwd = process.cwd()) {
  const head = (f, n = 8192) => { try { return readFileSync(join(cwd, f), 'utf8').slice(0, n); } catch { return ''; } };
  const json = (f) => { try { return JSON.parse(readFileSync(join(cwd, f), 'utf8')); } catch { return null; } };
  let kind = null, name = null, m;
  if ((m = /^[ \t/*#@]*Theme Name:\s*(.+)$/im.exec(head('style.css')))) { kind = 'theme'; name = m[1].trim(); }
  if (!kind) {
    let files = [];
    try { files = readdirSync(cwd).filter((f) => f.endsWith('.php')).slice(0, 40); } catch { /* unreadable */ }
    for (const f of files) if ((m = /^[ \t/*#@]*Plugin Name:\s*(.+)$/im.exec(head(f)))) { kind = 'plugin'; name = m[1].trim(); break; }
  }
  if (!kind && ['wp-config.php', 'wp-config-sample.php', 'wp-content', 'wp-load.php'].some((f) => existsSync(join(cwd, f)))) kind = 'site';
  const env = json('.wp-env.json'), envOverride = json('.wp-env.override.json');
  if (!kind && !env) return null;
  kind = kind || 'site';
  const urls = [];
  let devCommand = null;
  if (env) {
    urls.push(`http://localhost:${(envOverride && envOverride.port) || env.port || 8888}`);
    devCommand = 'npx wp-env start';
  }
  // DDEV and Lando name the site after the project.
  const ddev = head('.ddev/config.yaml');
  if ((m = /^name:\s*["']?([\w.-]+)/m.exec(ddev))) { urls.push(`https://${m[1]}.ddev.site`); devCommand = devCommand || 'ddev start'; }
  const lando = head('.lando.yml');
  if ((m = /^name:\s*["']?([\w.-]+)/m.exec(lando))) { urls.push(`https://${m[1]}.lndo.site`); devCommand = devCommand || 'lando start'; }
  // docker compose with a wordpress image: the published port of that service.
  for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
    const y = head(f, 20000);
    if (!/image:\s*["']?(wordpress|bitnami\/wordpress)/i.test(y)) continue;
    const ports = [...y.matchAll(/["']?(?:[\d.]+:)?(\d{2,5}):(80|8080|443)["']?/g)].map((x) => +x[1]);
    for (const p of ports) urls.push(`http://localhost:${p}`);
    devCommand = devCommand || `docker compose -f ${f} up -d`;
  }
  // LocalWP keeps sites in "Local Sites/<site>/app/public" and serves them as http://<site>.local.
  const local = /[\\/]Local Sites[\\/]([^\\/]+)[\\/]app[\\/]public/.exec(cwd);
  if (local) urls.push(`http://${local[1].toLowerCase()}.local`);
  // A WP_HOME / WP_SITEURL defined in wp-config.php (walk up from a theme or plugin).
  for (let d = cwd, i = 0; i < 6; d = dirname(d), i++) {
    if (!existsSync(join(d, 'wp-config.php'))) { if (dirname(d) === d) break; continue; }
    const cfg = readFileSync(join(d, 'wp-config.php'), 'utf8');
    if ((m = /define\(\s*['"]WP_(?:HOME|SITEURL)['"]\s*,\s*['"](https?:\/\/[^'"]+)['"]/.exec(cfg))) urls.unshift(m[1].replace(/\/$/, ''));
    break;
  }
  for (const p of [8888, 8080, 8000, 80, 10003, 10004, 10005]) urls.push(p === 80 ? 'http://localhost' : `http://localhost:${p}`);
  return { kind, name: name || basename(cwd), devCommand, urls: Array.from(new Set(urls)) };
}

// Is this URL a WordPress site? (looks for wp-content/wp-includes assets or the REST API link)
export function looksLikeWordPress(res) {
  if (!res || res.status >= 500) return false;
  const link = String((res.headers && res.headers.link) || '');
  return /\/wp-json\/|rest_route=/.test(link) || /\/wp-(content|includes)\/|<meta name="generator" content="WordPress/i.test(res.body || '');
}

export const COMMON_PORTS = [5173, 3000, 4321, 8080, 4200, 8000, 1234, 5000, 3001];
