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
  let result;
  try {
    result = await check({ cwd, log: () => {} });
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
    `renderlint found ${result.stats.errors} UI defect(s) in the rendered app. You are not done: fix every error below (in the source code), ` +
    'then finish. If one is genuinely intentional, mark that element with data-renderlint-ignore="<rule>" and data-renderlint-reason="…".\n\n' +
    formatPretty(result, { maxPerRule: 8, cwd }) + '\n');
  return 2;
}
