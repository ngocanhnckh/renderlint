import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { RULES } from './rules-meta.js';

const HELP = `renderlint — catch visual UI defects in any web frontend before they ship.

Usage
  renderlint [targets...] [options]     Check pages (URLs, .html files, a build dir, or auto-detect)
  renderlint init                       Set up renderlint in this project (config, scripts, agent instructions, skills)
                                        --no-install --no-build --no-hook --no-skills --no-browser; --force replaces edited skills
  renderlint storybook [url|dir]        Check every story of a Storybook (storybook-static/ or a running one)
  renderlint scan [dirs...]             Static source scan only (emoji, placeholder copy)
  renderlint explain [rule]             Describe rules and how to fix them
  renderlint watch [url]                Re-check whenever source files change
  renderlint hook                       Claude Code Stop-hook mode (blocks finishing while errors remain)
  renderlint routes                     List the routes found in the source (and which files each renders)

Targets
  http://localhost:5173                 a running app (dev or preview server)
  dist/  |  index.html                  static files (served automatically)
  (none)                                auto: renderlint.config → running dev server → \`npm run dev\` → build dir → index.html

Options
  --serve "<cmd>"        start this server command first (URL auto-detected from its output, or --url)
  --url <url>            base URL (with --serve)
  --base /repo/          public base path of a static build (Vite \`base\`, GitHub Pages)
  --pages /,/pricing     entry pages (default /)
  --no-crawl             do not follow links
  --max-pages <n>        page limit when crawling (default 12; with routes found in the source, every route)
  --no-routes            don't read routes from the source, sitemap and build output
  --per-route <n>        instances checked per dynamic route (default 2)
  --min-coverage <pct>   fail when fewer routes than this were checked (e.g. 100)
  --coverage-baseline <file>  fail when a route checked in this earlier coverage.json is no longer checked
  --viewports 375,768,1280   widths (or WxH) to test
  --dark | --light       force color schemes (default: auto-detect dark-mode CSS)
  --rules a=off,b=warn   override rule severities
  --stress [factor]      longer-text stress factor (default 1.5); --no-stress to disable
  --sweep 1024,1366      extra widths to check between the viewports (default: 13 widths, 320–1920); --no-sweep to disable
  --no-stress-data       don't reload pages with longer API data
  --cdp <url>            use a running Chromium over CDP (http://host:9222) instead of launching one; or RENDERLINT_CDP
  --concurrency <n>      browser contexts (page × viewport × color scheme) checked at once
  --dedupe template|off  share checks between pages that render alike (default: identical renderings only)
  --fail-on error|warn|never
  --format pretty|json|md|github
  --no-screenshots       skip annotated screenshots
  --no-scan              skip the static source scan
  --out <dir>            where to write reports and screenshots (default .renderlint)
  --globals theme:dark   storybook: also check every story with these globals (repeatable)
  --stories "button--*"  storybook: only these stories (story ids or "Title / Name", * wildcards)
  --config <file>        config file path
  -q, --quiet            only print the report
  -h, --help
`;

export async function main(argv) {
  // `--stress` may be used without a value: don't let it swallow the next argument.
  argv = argv.flatMap((a, i) => (a === '--stress' && !/^\d+(\.\d+)?$/.test(argv[i + 1] || '') ? ['--stress', '1.5'] : [a]));
  const cmd = ['init', 'scan', 'explain', 'watch', 'hook', 'check', 'storybook', 'routes'].includes(argv[0]) ? argv.shift() : 'check';
  if (argv.includes('-h') || argv.includes('--help')) { process.stdout.write(HELP); return 0; }
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
    return 0;
  }
  if (cmd === 'explain') return explain(argv[0]);
  if (cmd === 'init') return (await import('./init.js')).init(argv);
  if (cmd === 'hook') return (await import('./hook.js')).hook(argv);
  if (cmd === 'watch') return watch(argv);
  if (cmd === 'routes') return listRoutes(argv);
  if (cmd === 'scan') {
    const { scanSources } = await import('./scan.js');
    const issues = scanSources({ dirs: argv.filter((a) => !a.startsWith('-')) });
    for (const i of issues) console.log(`${i.file}:${i.line}:${i.column}  ${i.severity || 'error'}  ${i.rule}  ${i.message}`);
    console.log(issues.length ? `\n${issues.length} finding(s).` : 'No findings.');
    return issues.some((i) => (i.severity || 'error') === 'error') ? 1 : 0;
  }

  const options = {
      serve: { type: 'string' }, url: { type: 'string' }, base: { type: 'string' }, pages: { type: 'string' }, crawl: { type: 'boolean' }, 'no-crawl': { type: 'boolean' },
      'max-pages': { type: 'string' }, viewports: { type: 'string' }, dark: { type: 'boolean' }, light: { type: 'boolean' },
      rules: { type: 'string' }, stress: { type: 'string' }, 'fail-on': { type: 'string' }, format: { type: 'string' }, json: { type: 'boolean' },
      'no-screenshots': { type: 'boolean' }, 'no-stress': { type: 'boolean' }, 'no-scan': { type: 'boolean' }, config: { type: 'string' }, quiet: { type: 'boolean', short: 'q' },
      verbose: { type: 'boolean' }, 'max-per-rule': { type: 'string' }, out: { type: 'string' },
      globals: { type: 'string', multiple: true }, stories: { type: 'string' },
      sweep: { type: 'string' }, 'no-sweep': { type: 'boolean' }, 'no-stress-data': { type: 'boolean' }, concurrency: { type: 'string' }, dedupe: { type: 'string' }, cdp: { type: 'string' },
      'no-routes': { type: 'boolean' }, 'per-route': { type: 'string' }, 'min-coverage': { type: 'string' }, 'coverage-baseline': { type: 'string' },
  };
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: false, options });
  const unknown = Object.keys(values).filter((k) => !(k in options));
  if (unknown.length) {
    process.stderr.write(`Unknown option${unknown.length > 1 ? 's' : ''}: ${unknown.map((k) => '--' + k).join(', ')}. Run \`renderlint --help\` for the list.\n`);
    return 2;
  }

  const rules = {};
  for (const pair of (values.rules || '').split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    rules[k.trim()] = (v || 'error').trim();
  }
  const config = {
    serve: values.serve, url: values.url, base: values.base, rules,
    pages: values.pages ? values.pages.split(',') : undefined,
    crawl: values['no-crawl'] ? false : undefined,
    maxPages: values['max-pages'] ? +values['max-pages'] : undefined,
    viewports: values.viewports, stress: values['no-stress'] ? false : values.stress ? parseFloat(values.stress) : undefined,
    colorSchemes: values.dark && values.light ? ['light', 'dark'] : values.dark ? ['light', 'dark'] : values.light ? ['light'] : undefined,
    failOn: values['fail-on'], screenshots: values['no-screenshots'] ? false : undefined, outputDir: values.out,
    sweep: values['no-sweep'] ? false : values.sweep, stressData: values['no-stress-data'] ? false : undefined,
    concurrency: values.concurrency ? +values.concurrency : undefined, dedupe: values.dedupe, cdp: values.cdp,
    routes: values['no-routes'] ? false : undefined,
    ...(values['per-route'] || values['min-coverage'] || values['coverage-baseline'] ? { coverage: { perRoute: values['per-route'] ? +values['per-route'] : undefined, min: values['min-coverage'] ? +values['min-coverage'] : undefined, baseline: values['coverage-baseline'] } } : {}),
  };
  const format = values.json ? 'json' : values.format || 'pretty';
  const quiet = values.quiet || format !== 'pretty';
  const log = quiet ? () => {} : (m) => process.stderr.write('\x1b[2m' + m + '\x1b[0m\n');
  const { check, formatPretty, formatMarkdown, formatGithub } = await import('./index.js');
  let result;
  try {
    result = await check({ targets: cmd === 'storybook' ? [] : positionals, storybook: cmd === 'storybook' ? { target: positionals[0], globals: values.globals, stories: values.stories ? values.stories.split(',') : undefined } : undefined, config, configFile: values.config, scan: values['no-scan'] ? false : undefined, log: values.verbose || !quiet ? log : () => {} });
  } catch (e) {
    process.stderr.write('\n' + (e && e.message || e) + '\n');
    return 2;
  }
  if (format === 'json') process.stdout.write(JSON.stringify({ ok: result.ok, stats: result.stats, issues: result.issues }, null, 2) + '\n');
  else if (format === 'md') process.stdout.write(formatMarkdown(result) + '\n');
  else if (format === 'github') process.stdout.write(formatGithub(result) + '\n');
  else process.stdout.write('\n' + formatPretty(result, { maxPerRule: values['max-per-rule'] ? +values['max-per-rule'] : 12 }) + '\n');
  return result.ok ? 0 : 1;
}

async function listRoutes(argv) {
  const { discoverRoutes } = await import('./routes/discover.js');
  const { buildGraph, routeClosures, shellEntries } = await import('./routes/graph.js');
  const cwd = argv.find((a) => !a.startsWith('-')) || process.cwd();
  const t0 = Date.now();
  const d = discoverRoutes(cwd);
  if (!d.framework) { console.log('No supported router found (Next.js, Nuxt, SvelteKit, Astro, React Router, TanStack Router, Angular, Vue Router).'); return 1; }
  const g = argv.includes('--files') ? buildGraph(cwd, { framework: d.framework, routes: d.routes, entries: shellEntries(cwd, d.framework) }) : null;
  const cl = g && routeClosures(g);
  console.log(`${d.routes.length} route(s) (${d.framework}) in ${Date.now() - t0}ms${d.notes.length ? ' · ' + d.notes.join(' · ') : ''}`);
  d.routes.forEach((r, i) => {
    console.log(`  ${r.pattern.padEnd(36)} ${r.file || ''}${r.values ? '  values: ' + r.values.length : ''}${r.guards ? '  guards: ' + r.guards.join('; ') : ''}`);
    if (cl) console.log('      ' + Array.from(cl.per[i], (f) => f.replace(cwd + '/', '')).join(', '));
  });
  if (d.prerendered.length) console.log(`  + ${d.prerendered.length} prerendered URL(s) in the build output`);
  return 0;
}

function explain(rule) {
  if (rule && !RULES[rule]) { console.error(`Unknown rule "${rule}". Rules: ${Object.keys(RULES).join(', ')}`); return 2; }
  const list = rule ? [rule] : Object.keys(RULES);
  for (const id of list) {
    const r = RULES[id];
    console.log(`${id}  [${r.severity}] (${r.category})\n  ${r.summary}\n  Fix: ${r.fix}\n`);
  }
  return 0;
}

async function watch(argv) {
  const { watch: fsWatch, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { check, formatPretty } = await import('./index.js');
  const { launchBrowser } = await import('./browser.js');
  const { resolveTargets } = await import('./index.js');
  const { loadConfig, normalize } = await import('./config.js');
  const cwd = process.cwd();
  const targets = argv.filter((a) => !a.startsWith('-'));
  const { config } = await loadConfig(cwd);
  const resolved = await resolveTargets(targets, normalize(config), cwd, (m) => console.error(m));
  const browser = await launchBrowser({ cdp: normalize(config).cdp });
  let running = false, again = false, timer;
  const run = async () => {
    if (running) { again = true; return; }
    running = true;
    try {
      const r = await check({ cwd, targets: resolved.pages, browser, config: { crawl: config.crawl } });
      console.log('\x1b[2J\x1b[H' + new Date().toLocaleTimeString() + '\n' + formatPretty(r, { cwd }));
    } catch (e) { console.error(e.message); }
    running = false;
    if (again) { again = false; run(); }
  };
  await run();
  const dirs = ['src', 'app', 'pages', 'components', 'public', 'styles', 'lib'].map((d) => join(cwd, d)).filter((d) => existsSync(d));
  if (!dirs.length) dirs.push(cwd);
  const onChange = (ev, file) => {
    if (file && /node_modules|\.renderlint|\.git/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(run, 1200);
  };
  const { readdirSync } = await import('node:fs');
  const watchTree = (d, depth = 0) => {
    // recursive fs.watch is unavailable on Linux before Node 20: watch each directory
    fsWatch(d, onChange);
    if (depth > 8) return;
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && !/^(node_modules|\.git|\.renderlint|dist|build)$/.test(e.name)) watchTree(join(d, e.name), depth + 1);
  };
  for (const d of dirs) {
    try { fsWatch(d, { recursive: true }, onChange); } catch { watchTree(d); }
  }
  console.error('Watching ' + dirs.map((d) => d.replace(cwd + '/', '')).join(', ') + ' — Ctrl+C to stop.');
  await new Promise((resolve) => process.on('SIGINT', resolve));
  await browser.close();
  for (const fn of resolved.cleanup) await Promise.resolve(fn()).catch(() => {});
  return 0;
}
