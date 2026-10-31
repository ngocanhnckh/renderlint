// `renderlint hook`: Claude Code Stop hook. Runs the check when UI files
// changed since the last clean run; exit code 2 + stderr makes Claude keep
// working on the reported defects instead of ending its turn.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';

const UI_EXT = /\.(html?|jsx|tsx|vue|svelte|astro|css|scss|sass|less|mdx|js|ts|php|twig|blade\.php|liquid|hbs|ejs|njk|erb)$|^theme\.json$/;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.output', '.svelte-kit', '.astro', '.renderlint', 'coverage', '.turbo', '.vercel', '.cache', '.claude', 'vendor']);
const MAX_BLOCKS = 4;

function fingerprint(cwd) {
  const h = createHash('sha1');
  let n = 0;
  const walk = (d, depth) => {
    if (depth > 8 || n > 5000) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name) || (e.name.startsWith('.') && depth === 0 && e.isDirectory())) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (UI_EXT.test(e.name) && !/\.config\.|\.test\.|\.spec\./.test(e.name)) {
        try { const s = statSync(p); h.update(p + s.mtimeMs + ':' + s.size); n++; } catch { /* ignore */ }
      }
    }
  };
  walk(cwd, 0);
  return h.digest('hex');
}

// { result, scope } for a run limited to the affected routes; { skip } when the edit renders nowhere;
// null for a full run (no page map yet, or the edit can affect every route).
async function incremental(cwd, check) {
  if (process.env.RENDERLINT_HOOK_FULL) return null;
  const { loadConfig } = await import('./config.js');
  const { config } = await loadConfig(cwd);
  const { readPageMap, planIncremental, updatePageMap } = await import('./routes/incremental.js');
  const map = readPageMap(config.outputDir);
  if (!map) return null;
  const plan = planIncremental(cwd, map);
  if (plan.mode === 'all') return null;
  if (plan.mode === 'none') {
    if (plan.failing.length) return null; // nothing rendered changed, but errors remain: report them with a full run
    updatePageMap(config.outputDir, map, plan, { issues: [] });
    return { skip: true };
  }
  const result = await check({ cwd, log: () => {}, config: { pages: plan.paths, crawl: false, routes: false } });
  const stale = updatePageMap(config.outputDir, map, plan, result);
  // routes not re-checked that still had errors in the last run keep the hook blocking, as a full run would
  if (stale.length) {
    result.ok = false;
    result.stats.errors += stale.reduce((n, r) => n + r.errors, 0);
  }
  const scope = ` (re-checked ${plan.routes.length} of ${map.routes.length} route(s) affected by ${plan.changed.length} changed file(s)` + (stale.length ? `; ${stale.map((r) => r.pattern).join(', ')} still had errors in the last full run` : '') + ')';
  return { result, scope };
}

async function readStdin() {
  if (process.stdin.isTTY) return {};
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}

export async function hook() {
  // A hook must never trap the agent because of renderlint's own failures.
  try { return await runHook(); } catch (e) {
    process.stderr.write(`renderlint hook error (ignored): ${String(e && e.message || e).split('\n')[0]}\n`);
    return 0;
  }
}

async function runHook() {
  const input = await readStdin();
  const cwd = input.cwd || process.cwd();
  process.chdir(cwd);
  const stateDir = join(cwd, '.renderlint');
  mkdirSync(stateDir, { recursive: true });
  const statePath = join(stateDir, 'hook-state.json');
  let state = {};
  try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* first run */ }
  const fp = fingerprint(cwd);
  if (state.cleanFingerprint === fp) return 0; // nothing changed since the last clean check
  if (!input.stop_hook_active) {
    if (state.lastSeen === fp) return 0; // no UI files touched during this turn
    state.blocks = 0;
  }
  state.lastSeen = fp;
  writeFileSync(statePath, JSON.stringify(state)); // saved before checking, so a crash doesn't re-run every turn

  const { check, formatPretty } = await import('./index.js');
  let result, scope = '';
  try {
    // After a full run (page-map.json), re-check only the routes the changed files render in.
    const inc = await incremental(cwd, check);
    if (inc && inc.skip) { state = { cleanFingerprint: fp, lastSeen: fp, blocks: 0 }; writeFileSync(statePath, JSON.stringify(state)); return 0; }
    if (inc) { result = inc.result; scope = inc.scope; } else result = await check({ cwd, log: () => {} });
  } catch (e) {
    // Can't check (no server, etc.): never trap the agent, just tell it.
    process.stderr.write(`renderlint could not run: ${String(e.message || e).split('\n')[0]}\n`);
    return 0;
  }
  if (result.ok) {
    state = { cleanFingerprint: fp, lastSeen: fp, blocks: 0 };
    writeFileSync(statePath, JSON.stringify(state));
    return 0;
  }
  state.blocks = (state.blocks || 0) + 1;
  writeFileSync(statePath, JSON.stringify(state));
  if (state.blocks > MAX_BLOCKS) {
    process.stderr.write(`renderlint: ${result.stats.errors} UI error(s) remain after ${MAX_BLOCKS} attempts; letting you stop. Tell the user which defects are unresolved.\n`);
    return 0;
  }
  process.stderr.write(
    `renderlint found ${result.stats.errors} UI defect(s) in the rendered app${scope}. You are not done: fix every error below (in the source code), ` +
    'then finish. If one is genuinely intentional, mark that element with data-renderlint-ignore="<rule>" and data-renderlint-reason="…".\n\n' +
    formatPretty(result, { maxPerRule: 8, cwd }) + '\n');
  return 2;
}
