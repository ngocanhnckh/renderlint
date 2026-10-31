// Server-side mocks: what renderlint tells the preload (src/server-mock.cjs) it runs in the app's
// server process, and what that preload reports back (the server's own requests, per page run).
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PRELOAD = fileURLToPath(new URL('./server-mock.cjs', import.meta.url));
// Cookies renderlint sends with every page request, which the preload reads.
export const ROLE_COOKIE = 'renderlint-role', RUN_COOKIE = 'renderlint-run', STRESS_COOKIE = 'renderlint-stress', STATE_COOKIE = 'renderlint-state';

const hasMocks = (config) => Object.keys(config.mock || {}).length > 0 ||
  Object.values(config.roles || {}).some((r) => Object.keys(r.mock || {}).length) ||
  (config.states || []).some((s) => Object.keys(s.mock || {}).length);

// The plan file (written whenever "mock" or a role's or state's mocks are set, so a server you start
// yourself with the preload reads it too) and the environment that loads the preload into a server renderlint starts.
export function serverPlan(config) {
  if (config.serverMock === false || !hasMocks(config)) return null;
  mkdirSync(config.outputDir, { recursive: true });
  const file = join(config.outputDir, 'server-mock.json');
  const log = join(config.outputDir, 'server-requests.jsonl');
  writeFileSync(log, '');
  const plan = {
    mock: config.mock || {},
    roles: Object.fromEntries(Object.entries(config.roles || {}).map(([k, r]) => [k, r.mock || {}])),
    states: Object.fromEntries((config.states || []).filter((s) => Object.keys(s.mock || {}).length).map((s) => [s.name, s.mock])),
    log, self: [],
  };
  const write = () => writeFileSync(file, JSON.stringify(plan, null, 2));
  write();
  const opts = (process.env.NODE_OPTIONS || '').trim();
  return {
    file, log,
    env: { NODE_OPTIONS: (opts ? opts + ' ' : '') + `--require "${PRELOAD}"`, RENDERLINT_SERVER_MOCK: file },
    // the app's own origin is never mocked (its own routes, dev-server proxy hops)
    setSelf(url) { try { const o = new URL(url).origin; if (!plan.self.includes(o)) { plan.self.push(o); write(); } } catch { /* not a URL */ } },
    reader: logReader(log),
  };
}

// Reads the preload's request log as it grows: entries(run) are the server requests made while rendering that run's pages.
export function logReader(file) {
  let offset = 0, rest = '';
  const byRun = new Map();
  const poll = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= offset) return;
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(size - offset);
      readSync(fd, buf, 0, buf.length, offset);
      offset = size;
      const lines = (rest + buf.toString('utf8')).split('\n');
      rest = lines.pop();
      for (const line of lines) {
        let e;
        try { e = JSON.parse(line); } catch { continue; }
        if (!e.run) continue;
        if (!byRun.has(e.run)) byRun.set(e.run, []);
        byRun.get(e.run).push(e);
      }
    } finally { closeSync(fd); }
  };
  return { entries(run) { poll(); return byRun.get(run) || []; } };
}

export function readPlan(file) { return JSON.parse(readFileSync(file, 'utf8')); }
