// Vite plugin (React, Vue, Svelte, Solid, Preact, Lit, Qwik… any Vite app).
//
//   // vite.config.ts
//   import renderlint from '@yitec/renderlint/vite';
//   export default defineConfig({ plugins: [react(), renderlint()] });
//
// dev:   injects an in-page checker; findings show in a corner overlay and are
//        printed in the dev-server terminal (where coding agents read logs).
// build: after `vite build`, renders the output in a headless browser and
//        FAILS THE BUILD when error-level UI defects are found.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The package name the injected client import resolves to in the user's project.
const PKG = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).name;

const VIRTUAL = 'virtual:renderlint-client';
const RESOLVED = '\0' + VIRTUAL;

export default function renderlint(options = {}) {
  const { overlay = true, build = true, rules, ...checkConfig } = options;
  let config;
  let lastPrinted = '';
  return {
    name: 'renderlint',
    configResolved(c) { config = c; },
    resolveId(id) { return id === VIRTUAL ? RESOLVED : undefined; },
    load(id) {
      if (id !== RESOLVED) return undefined;
      return `import { start } from '${PKG}/client';
start(${JSON.stringify({ rules: rules || {}, overlay })}, (report) => { if (import.meta.hot) import.meta.hot.send('renderlint:report', report); });`;
    },
    transformIndexHtml: {
      order: 'post',
      handler() {
        if (!config || config.command !== 'serve') return undefined;
        return [{ tag: 'script', attrs: { type: 'module', src: '/@id/__x00__' + VIRTUAL }, injectTo: 'body' }];
      },
    },
    configureServer(server) {
      server.ws.on('renderlint:report', (report) => {
        const lines = formatDevReport(report);
        const key = lines.join('\n');
        if (key === lastPrinted) return;
        lastPrinted = key;
        server.config.logger.info(lines.join('\n'), { timestamp: true });
      });
    },
    async closeBundle() {
      if (!build || !config || config.command !== 'build' || config.build.ssr || process.env.RENDERLINT_SKIP) return;
      const outDir = resolve(config.root, config.build.outDir);
      if (!existsSync(join(outDir, 'index.html'))) return; // SSR frameworks: use the CLI against a preview server
      const { check, formatPretty } = await import('../index.js');
      const result = await check({ targets: [outDir], cwd: config.root, config: { base: config.base, rules: rules || {}, ...checkConfig } });
      const text = formatPretty(result, { cwd: config.root });
      if (!result.ok) {
        const err = new Error(`renderlint: ${result.stats.errors} UI defect(s) — build failed.\n\n${text}\n`);
        err.stack = err.message; // keep the output readable
        throw err;
      }
      config.logger.info('\n' + text);
    },
  };
}

function formatDevReport(report) {
  const errors = report.issues.filter((i) => i.severity === 'error');
  const warns = report.issues.filter((i) => i.severity !== 'error');
  if (!report.issues.length) return [`[renderlint] ✔ ${report.url} @${report.viewport}px — no UI defects`];
  const out = [`[renderlint] ${errors.length} error(s), ${warns.length} warning(s) on ${report.url} @${report.viewport}px (run \`npx renderlint\` for all viewports + pixel contrast)`];
  for (const i of report.issues.slice(0, 25)) {
    const src = i.source && i.source.file ? ` (${i.source.file}${i.source.line ? ':' + i.source.line : ''})` : '';
    out.push(`  ${i.severity === 'error' ? '✖' : '⚠'} ${i.rule}: ${i.message}\n      at ${i.selector}${src}`);
  }
  if (report.issues.length > 25) out.push(`  … ${report.issues.length - 25} more`);
  return out;
}
