import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { RULES } from './rules-meta.js';

const HELP = `renderlint — catch visual UI defects in any web frontend before they ship.

Usage
  renderlint [targets...] [options]     Check pages (URLs, .html files, a build dir, or auto-detect)
  renderlint init                       Set up renderlint in this project (config, scripts, agent instructions)
  renderlint scan [dirs...]             Static source scan only (emoji, placeholder copy)
  renderlint explain [rule]             Describe rules and how to fix them
  renderlint watch [url]                Re-check whenever source files change
  renderlint hook                       Claude Code Stop-hook mode (blocks finishing while errors remain)

Targets
  http://localhost:5173                 a running app (dev or preview server)
  dist/  |  index.html                  static files (served automatically)
  (none)                                auto: renderlint.config → running dev server → \`npm run dev\` → build dir → index.html

Options
  --serve "<cmd>"        start this server command first (URL auto-detected from its output, or --url)
  --url <url>            base URL (with --serve)
  --pages /,/pricing     entry pages (default /)
  --no-crawl             do not follow links
  --max-pages <n>        page limit when crawling (default 12)
  --viewports 375,768,1280   widths (or WxH) to test
  --dark | --light       force color schemes (default: auto-detect dark-mode CSS)
  --rules a=off,b=warn   override rule severities
  --stress [factor]      also re-check with longer text (default factor 1.5)
  --fail-on error|warn|never
  --format pretty|json|md|github
  --no-screenshots       skip annotated screenshots
  --no-scan              skip the static source scan
  --config <file>        config file path
  -q, --quiet            only print the report
  -h, --help
`;

export async function main(argv) {
  const cmd = ['init', 'scan', 'explain', 'watch', 'hook', 'check'].includes(argv[0]) ? argv.shift() : 'check';
  if (argv.includes('-h') || argv.includes('--help')) { process.stdout.write(HELP); return 0; }
  if (argv.includes('-v') || argv.includes('--version')) {
    process.stdout.write(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version + '\n');
    return 0;
  }
  if (cmd === 'explain') return explain(argv[0]);
  if (cmd === 'init') return (await import('./init.js')).init(argv);
  if (cmd === 'hook') return (await import('./hook.js')).hook(argv);
  if (cmd === 'scan') {
    const { scanSources } = await import('./scan.js');
    const issues = scanSources({ dirs: argv.filter((a) => !a.startsWith('-')) });
    for (const i of issues) console.log(`${i.file}:${i.line}:${i.column}  ${i.severity || 'error'}  ${i.rule}  ${i.message}`);
    console.log(issues.length ? `\n${issues.length} finding(s).` : 'No findings.');
    return issues.some((i) => (i.severity || 'error') === 'error') ? 1 : 0;
  }

  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: false,
    options: {
      serve: { type: 'string' }, url: { type: 'string' }, pages: { type: 'string' }, crawl: { type: 'boolean' }, 'no-crawl': { type: 'boolean' },
      'max-pages': { type: 'string' }, viewports: { type: 'string' }, dark: { type: 'boolean' }, light: { type: 'boolean' },
      rules: { type: 'string' }, stress: { type: 'string' }, 'fail-on': { type: 'string' }, format: { type: 'string' }, json: { type: 'boolean' },
      'no-screenshots': { type: 'boolean' }, 'no-scan': { type: 'boolean' }, config: { type: 'string' }, quiet: { type: 'boolean', short: 'q' },
      verbose: { type: 'boolean' }, 'max-per-rule': { type: 'string' },
    },
  });
  // `--stress` without a value
  if (argv.includes('--stress') && (values.stress === undefined || values.stress === true || /^-/.test(String(values.stress)))) values.stress = '1.5';

  const rules = {};
  for (const pair of (values.rules || '').split(',').filter(Boolean)) {
    const [k, v] = pair.split('=');
    rules[k.trim()] = (v || 'error').trim();
  }
  const config = {
    serve: values.serve, url: values.url, rules,
    pages: values.pages ? values.pages.split(',') : undefined,
    crawl: values['no-crawl'] ? false : undefined,
    maxPages: values['max-pages'] ? +values['max-pages'] : undefined,
    viewports: values.viewports, stress: values.stress ? parseFloat(values.stress) : undefined,
    colorSchemes: values.dark && values.light ? ['light', 'dark'] : values.dark ? ['light', 'dark'] : values.light ? ['light'] : undefined,
    failOn: values['fail-on'], screenshots: values['no-screenshots'] ? false : undefined,
  };
  const format = values.json ? 'json' : values.format || 'pretty';
  const quiet = values.quiet || format !== 'pretty';
  const log = quiet ? () => {} : (m) => process.stderr.write('\x1b[2m' + m + '\x1b[0m\n');
  const { check, formatPretty, formatMarkdown, formatGithub } = await import('./index.js');
  let result;
  try {
    result = await check({ targets: positionals, config, configFile: values.config, scan: values['no-scan'] ? false : undefined, log: values.verbose || !quiet ? log : () => {} });
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

function explain(rule) {
  if (rule && !RULES[rule]) { console.error(`Unknown rule "${rule}". Rules: ${Object.keys(RULES).join(', ')}`); return 2; }
  const list = rule ? [rule] : Object.keys(RULES);
  for (const id of list) {
    const r = RULES[id];
    console.log(`${id}  [${r.severity}] (${r.category})\n  ${r.summary}\n  Fix: ${r.fix}\n`);
  }
  return 0;
}
