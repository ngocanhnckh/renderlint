// Framework / project detection, used for zero-config runs and `renderlint init`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  };
}

export const COMMON_PORTS = [5173, 3000, 4321, 8080, 4200, 8000, 1234, 5000, 3001];
