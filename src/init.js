// `renderlint init`: wire renderlint into a project so agents (and CI) can't
// ship UI defects. Idempotent: safe to run again.
import { existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { detectProject } from './detect.js';
import { findWordPress } from './index.js';
import { agentSection, upsertSection } from './agent-instructions.js';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_SPEC = '@ngocanhnckh/renderlint';
const PREVIEW_PORT = 4319;

function readJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, v) { writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }

export async function init(argv = []) {
  const cwd = process.cwd();
  const flag = (f) => argv.includes(f);
  const opt = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : undefined; };
  const done = [];
  const say = (m) => { done.push(m); console.log('  ✔ ' + m); };
  console.log('renderlint init\n');

  // 0. package.json (plain HTML projects get a minimal one so `npx renderlint` resolves locally)
  if (!existsSync(join(cwd, 'package.json')) && !flag('--no-install')) {
    writeJson(join(cwd, 'package.json'), { name: (cwd.split(/[\\/]/).pop() || 'site').toLowerCase().replace(/[^a-z0-9-]/g, '-'), private: true, version: '0.0.0', scripts: {} });
    say('created package.json (for the renderlint dev dependency)');
  }
  let proj = detectProject(cwd);

  // 1. install as a dev dependency
  const installed = proj.pkg && ({ ...proj.pkg.dependencies, ...proj.pkg.devDependencies }).renderlint;
  if (!installed && !flag('--no-install')) {
    const spec = opt('--spec') || process.env.RENDERLINT_SPEC || defaultSpec();
    const cmd = { npm: ['npm', ['install', '-D', spec]], pnpm: ['pnpm', ['add', '-D', spec]], yarn: ['yarn', ['add', '-D', spec]], bun: ['bun', ['add', '-d', spec]] }[proj.pm];
    console.log(`  … installing ${spec} with ${proj.pm}`);
    const r = spawnSync(cmd[0], cmd[1], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status !== 0) console.log(`  ! install failed — run \`${cmd[0]} ${cmd[1].join(' ')}\` yourself`);
    else say(`added renderlint to devDependencies (${spec})`);
    proj = detectProject(cwd);
  }

  // 2. config
  const configFiles = ['renderlint.config.js', 'renderlint.config.mjs', 'renderlint.config.cjs', 'renderlint.config.json', '.renderlintrc.json'];
  if (!configFiles.some((f) => existsSync(join(cwd, f)))) {
    const cfg = { pages: ['/'], viewports: [375, 768, 1280] };
    const wp = proj.wordpress;
    if (wp) {
      // PHP renders the pages: point at the local site (started with `serve` when it isn't running).
      cfg.url = (await findWordPress(wp.urls)) || wp.urls[0];
      if (wp.devCommand) cfg.serve = wp.devCommand;
    } else if (proj.devCommand) cfg.serve = proj.devCommand;
    else if (proj.staticDirs.length && !proj.hasIndexHtml) cfg.dir = proj.staticDirs[0];
    else if (proj.hasIndexHtml) cfg.dir = '.';
    cfg.rules = {};
    cfg.ignore = [];
    writeJson(join(cwd, 'renderlint.config.json'), cfg);
    say('wrote renderlint.config.json' + (wp ? ` (checks the WordPress site at ${cfg.url}${cfg.serve ? `, started with \`${cfg.serve}\`` : ''}; change "url" if your local site lives elsewhere)` : cfg.serve ? ` (checks your dev server: ${cfg.serve})` : cfg.dir ? ` (serves ${cfg.dir})` : ''));
  }

  // 3. package.json scripts: lint:ui, and make `build` fail on UI defects
  if (proj.pkg) {
    const pkgPath = join(cwd, 'package.json');
    const pkg = readJson(pkgPath);
    pkg.scripts = pkg.scripts || {};
    if (!pkg.scripts['lint:ui']) { pkg.scripts['lint:ui'] = 'renderlint'; say('added "lint:ui": "renderlint" script'); }
    const build = pkg.scripts.build;
    if (build && !/renderlint/.test(build) && !flag('--no-build') && !proj.wordpress) {
      const post = buildCheckCommand(proj);
      if (post) { pkg.scripts.build = `${build} && ${post}`; say(`"build" now fails on UI defects: ${pkg.scripts.build}`); }
    }
    writeJson(pkgPath, pkg);
  }

  // 4. agent instructions
  const section = agentSection('npx renderlint', { wordpress: proj.wordpress });
  const agentsPath = join(cwd, 'AGENTS.md');
  writeFileSync(agentsPath, upsertSection(existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '# Agent instructions\n\n', section));
  say('AGENTS.md: added the renderlint workflow (read by Codex, Cursor, Copilot, Gemini, Amp, Zed, …)');
  const claudePath = join(cwd, 'CLAUDE.md');
  if (existsSync(claudePath)) {
    const cur = readFileSync(claudePath, 'utf8');
    if (!/@AGENTS\.md/.test(cur)) { writeFileSync(claudePath, upsertSection(cur, section)); say('CLAUDE.md: added the renderlint workflow'); }
  } else {
    writeFileSync(claudePath, '@AGENTS.md\n');
    say('CLAUDE.md: created (imports AGENTS.md)');
  }

  // 5. Claude Code Stop hook: Claude can't end its turn while UI errors remain
  if (!flag('--no-hook')) {
    const dir = join(cwd, '.claude');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'settings.json');
    const s = readJson(p) || {};
    s.hooks = s.hooks || {};
    s.hooks.Stop = s.hooks.Stop || [];
    const has = JSON.stringify(s.hooks.Stop).includes('renderlint hook');
    if (!has) {
      s.hooks.Stop.push({ hooks: [{ type: 'command', command: 'npx renderlint hook', timeout: 600 }] });
      writeJson(p, s);
      say('.claude/settings.json: Stop hook runs renderlint before Claude Code finishes (disable with --no-hook)');
    }
  }

  // 6. .gitignore
  const gi = join(cwd, '.gitignore');
  const cur = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  if (!/^\.renderlint\/?$/m.test(cur)) { writeFileSync(gi, cur.replace(/\s*$/, cur ? '\n' : '') + '.renderlint/\n'); say('.gitignore: ignore .renderlint/ output'); }

  // 7. browser
  if (!flag('--no-browser')) {
    try {
      const { launchBrowser } = await import('./browser.js');
      const b = await launchBrowser({ log: (m) => console.log('  … ' + m) });
      await b.close();
      say('headless Chromium is available');
    } catch (e) { console.log('  ! could not start Chromium: ' + e.message.split('\n')[0]); }
  }

  console.log(`
Done. Next:
  npx renderlint            check the UI now (auto-starts your dev server if needed)
  npx renderlint explain    list every rule
${proj.framework && /vite|sveltekit|astro|qwik|remix|react-router/.test(proj.framework.id) ? `
Optional (Vite): live overlay + terminal output while developing:
  // vite.config: import renderlint from '@ngocanhnckh/renderlint/vite'; plugins: [..., renderlint()]
` : ''}
Agents: follow the "UI quality gate: renderlint" section in AGENTS.md.`);
  return 0;
}

function defaultSpec() {
  // When run from a local checkout (development), install that checkout.
  try {
    const own = readJson(join(PKG_ROOT, 'package.json'));
    if (existsSync(join(PKG_ROOT, '.git')) && own && own.name === DEFAULT_SPEC) return 'file:' + realpathSync(PKG_ROOT);
  } catch { /* ignore */ }
  return DEFAULT_SPEC;
}

function buildCheckCommand(proj) {
  const fw = proj.framework;
  if (!fw) return proj.staticDirs.length ? `renderlint ${proj.staticDirs[0]}` : null;
  if (['vite', 'cra', 'vue-cli', 'parcel', 'qwik', 'gatsby', 'eleventy', 'webpack'].includes(fw.id)) return `renderlint ${fw.out[0] || 'dist'}`;
  if (fw.id === 'angular') return `renderlint dist/${proj.pkg.name}/browser`;
  if (fw.preview) return `renderlint --serve "${fw.preview(PREVIEW_PORT)}" --url http://localhost:${PREVIEW_PORT}`;
  return null;
}

