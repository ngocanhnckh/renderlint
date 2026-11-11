import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism, freemem, platform } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from './rules-meta.js';
import { normalizeAuth, forgeJwt } from './auth.js';


// Half the CPU cores, 3 to 4 (each extra one finishes sooner but holds about 180 MB more at once; the CPU
// work is the same), and no more contexts than the free memory holds: about 250 MB each on top of
// about 1 GB for the browser, Node and the system. Free memory is what the OS can hand out (Linux
// MemAvailable, a container's limit with Node 20.13+); macOS reports only its never-used pages, so
// it isn't capped there.
export function defaultConcurrency({ cores = availableParallelism(), free = availableMem(), os = platform() } = {}) {
  const byCpu = Math.min(4, Math.max(3, cores >> 1));
  if (os === 'darwin' || !(free > 0)) return byCpu;
  return Math.max(1, Math.min(byCpu, Math.floor((free - 1024 * 2 ** 20) / (250 * 2 ** 20))));
}
function availableMem() {
  try { if (typeof process.availableMemory === 'function') return process.availableMemory(); } catch { /* old Node */ }
  return freemem();
}
export const DEFAULTS = {
  url: undefined,          // base URL of a running app
  serve: undefined,        // command that starts a server (e.g. "npm run dev")
  dir: undefined,          // static directory to serve (e.g. "dist")
  base: undefined,         // public base path the build expects, e.g. "/my-repo/" (Vite `base`)
  pages: ['/'],            // entry pages (paths or absolute URLs)
  crawl: true,             // follow same-origin links from entry pages
  maxPages: undefined,     // page limit per role; default 12 when crawling without routes, every planned instance with routes
  routes: undefined,       // route coverage: read the app's routes from its source (Next, Nuxt, SvelteKit, Astro, React Router, TanStack, Angular, Vue Router), sitemap and build output, else from its router at runtime; false: off
  params: {},              // values for dynamic routes: { "/products/:id": ["a1", "b2"], "slug": "hello" } (default: from links, the build and the API data)
  coverage: {},            // { perRoute: 2, min: 100, ignore: ["/admin/*"], baseline: ".renderlint/coverage-baseline.json" }
  exclude: [],             // path globs to skip while crawling, e.g. "/blog/*"
  viewports: [375, 768, 1280],
  colorSchemes: 'auto',    // 'auto' (light + dark if the app has dark-mode CSS) | ['light'] | ['light','dark']
  rules: {},               // { "line-length": "off", "tap-target": "error" }
  ignore: [],              // [{ rule: "contrast", selector: ".legal" }]
  failOn: 'error',         // 'error' | 'warn' | 'never'
  screenshots: true,
  outputDir: '.renderlint',
  autoScroll: true,
  reducedMotion: true,
  stress: 1.5,             // re-check with 50% longer text, long unbreakable words and declared samples (fragile-layout); false to disable
  sweep: true,             // also check these widths between the main viewports (layout rules only); false to disable
  sweepBreakpoints: true,  // with sweep: true, also check both sides of every width breakpoint the page uses (CSS media queries, matchMedia)
  stressData: true,        // also reload pages that fetch JSON with longer API data; false to disable
  states: [],              // extra UI states to check: [{ name, page, click, hover, fill, press, waitFor, mock, run }]
  auth: null,              // signed-in pages: { login: '/login', user: '${RENDERLINT_USER}', password: '${RENDERLINT_PASSWORD}' } or { storage: { sessionStorage: { token: 'test' } } }
  mock: {},                // API responses to serve instead: { "**/api/orders*": "fixtures/orders.json" | { status, json } | data }
  mockFrom: [],            // API responses from the project's MSW handlers ("src/mocks/handlers.ts") or a HAR recording ("recordings/app.har")
  roles: null,             // check the app as each role, all at once: { admin: { storage | login …, mock, pages, deny }, viewer: { … } }
  serverMock: true,        // when renderlint starts the server ("serve"), "mock" answers the server's own requests too (SSR)
  scan: true,              // static source scan (emoji, placeholder copy) in addition to rendering
  scanDirs: undefined,
  contrastLevel: 'AA',
  minTapTarget: 24,
  minFontSize: 12,
  maxLineLength: 120,
  concurrency: defaultConcurrency(), // browser contexts (page × viewport × color scheme) checked in parallel
  dedupe: true,            // pages that render identically share the contrast/stress/sweep results; 'template' also skips stress/sweep on pages built like an earlier one; false: off
  menus: true,             // open each menu / dropdown trigger on the page and check that what opens can be seen (popup-obscured)
  loading: true,           // reload each page with its data requests held (a slow network) and check it shows a loading state (loading-state)
  ux: false,               // the UX pass (--ux): click every kind of button, tab, link and form on each page and check how it responds; or { maxActions, mutations: 'mock' | 'allow' }
  cdp: null,               // "http://host:9222": use a running Chromium over CDP instead of launching one (also RENDERLINT_CDP)
  timeout: 30000,
  serverTimeout: 120000,
  maxScreenshotHeight: 12000,
  waitFor: undefined,      // selector to wait for before checking
  delay: 0,                // extra ms to wait after load
};

export const SWEEP_WIDTHS = Object.freeze([320, 360, 414, 480, 600, 720, 900, 1024, 1100, 1366, 1440, 1536, 1920]);

const FILES = ['renderlint.config.js', 'renderlint.config.mjs', 'renderlint.config.cjs', 'renderlint.config.json', '.renderlintrc.json', '.renderlintrc'];

export async function loadConfig(cwd = process.cwd(), explicit) {
  let user = {};
  let file;
  if (explicit) file = resolve(cwd, explicit);
  else file = FILES.map((f) => join(cwd, f)).find((f) => existsSync(f));
  if (file) {
    if (/\.(c|m)?js$/.test(file)) {
      const mod = await import(pathToFileURL(file).href);
      user = mod.default || mod;
      if (typeof user === 'function') user = await user();
    } else {
      user = JSON.parse(readFileSync(file, 'utf8'));
    }
  } else if (existsSync(join(cwd, 'package.json'))) {
    try { user = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')).renderlint || {}; } catch { /* ignore */ }
  }
  const from = file || join(cwd, 'package.json');
  if (user && typeof user === 'object' && (user.auth || user.roles)) {
    // a value a JS config reads from process.env is not in its source: only what is written out counts
    let text = null;
    try { text = readFileSync(from, 'utf8'); } catch { /* ignore */ }
    for (const where of literalSecrets(user, text)) console.warn(`renderlint: ${where} is written out in ${basename(from)}. Keep it out of the repository: write "\${SOME_ENV_VAR}" and set the variable where renderlint runs.`);
  }
  return { config: normalize({ ...DEFAULTS, ...user }, cwd), file };
}

// Passwords and real-looking tokens written in the config file's auth settings, as "auth.password",
// "roles.admin.storage.localStorage.token". Placeholder tokens ("test") and { "$jwt": … } are not secrets.
const PASSWORD_KEY = /pass(word|wd)?\b|passphrase|secret/i;
const TOKEN_KEY = /token|jwt|api[-_]?key|bearer|authorization|session|sid$|credential|cookie/i;
export function literalSecrets(c, source = null) {
  const found = [];
  const realToken = (v) => /^(Bearer\s+)?eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(v) || (v.length >= 20 && /\d/.test(v) && /[a-z]/i.test(v) && !/\s/.test(v));
  const walk = (v, path, key) => {
    if (typeof v === 'string') {
      if (!v || /\$\{\w+\}/.test(v) || (source !== null && !source.includes(v))) return;
      if (PASSWORD_KEY.test(key) || (TOKEN_KEY.test(key) && realToken(v))) found.push(path);
      return;
    }
    if (!v || typeof v !== 'object' || v.$jwt) return;
    // cookies: [{ name: "session", value: "…" }]
    const named = typeof v.name === 'string' && 'value' in v ? v.name : null;
    for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`, k === 'value' && named ? named : k);
  };
  const scan = (auth, path) => { if (auth && typeof auth === 'object') { const { mock, pages, deny, roles, ...rest } = auth; walk(rest, path, ''); if (roles) for (const [n, r] of Object.entries(roles)) scan(r, `${path}.roles.${n}`); } };
  if (c && typeof c === 'object') {
    scan(c.auth, 'auth');
    if (c.roles && typeof c.roles === 'object') for (const [n, r] of Object.entries(c.roles)) scan(r, `roles.${n}`);
  }
  return found;
}

export function normalize(c, cwd = process.cwd()) {
  const out = { ...c };
  out.viewports = (Array.isArray(c.viewports) ? c.viewports : String(c.viewports).split(',')).map((v) => {
    if (typeof v === 'object') return { width: +v.width, height: +(v.height || defaultHeight(+v.width)) };
    const [w, h] = String(v).trim().split('x').map(Number);
    return { width: w, height: h || defaultHeight(w) };
  }).filter((v) => v.width > 0).sort((a, b) => a.width - b.width);
  out.rules = { ...(c.rules || {}) };
  for (const [k, v] of Object.entries(out.rules)) {
    const sev = v === 0 || v === false ? 'off' : v === 1 ? 'warn' : v === 2 || v === true ? 'error' : String(v);
    if (!['off', 'warn', 'error'].includes(sev)) throw new Error(`renderlint: invalid severity "${v}" for rule "${k}" (use off | warn | error)`);
    if (!RULES[k]) console.warn(`renderlint: unknown rule "${k}" in config`);
    out.rules[k] = sev;
  }
  if (out.stress === true) out.stress = 1.5;
  if (typeof out.colorSchemes === 'string' && out.colorSchemes !== 'auto') out.colorSchemes = out.colorSchemes.split(',');
  if (typeof out.pages === 'string') out.pages = out.pages.split(',');
  out.outputDir = resolve(cwd, out.outputDir);
  if (!out.viewports.length || out.viewports.some((v) => !Number.isFinite(v.width) || !Number.isFinite(v.height))) {
    throw new Error(`renderlint: invalid viewports ${JSON.stringify(c.viewports)} (use widths like 375,768,1280 or WxH like 390x844)`);
  }
  for (const k of ['maxPages', 'timeout', 'serverTimeout', 'concurrency', 'minTapTarget', 'minFontSize', 'maxLineLength', 'maxScreenshotHeight']) {
    if (out[k] !== undefined && !(Number.isFinite(+out[k]) && +out[k] > 0)) throw new Error(`renderlint: "${k}" must be a positive number (got ${JSON.stringify(c[k])})`);
    if (out[k] !== undefined) out[k] = +out[k];
  }
  if (out.stress !== false && out.stress !== undefined && !(Number.isFinite(+out.stress) && +out.stress >= 1)) throw new Error(`renderlint: "stress" must be a factor >= 1 or false (got ${JSON.stringify(c.stress)})`);
  // sweep: true is the default list (the same array, so normalizing twice keeps it recognizable); an explicit list is used as is
  const defaultSweep = out.sweep === true || out.sweep === undefined || out.sweep === SWEEP_WIDTHS;
  out.sweepBreakpoints = out.sweepBreakpoints !== false && defaultSweep;
  out.sweep = out.sweep === false ? [] : defaultSweep ? SWEEP_WIDTHS : (Array.isArray(out.sweep) ? out.sweep : String(out.sweep).split(',')).map(Number);
  if (out.sweep.some((w) => !(w >= 200 && w <= 4000))) throw new Error(`renderlint: "sweep" must be true, false or a list of widths (got ${JSON.stringify(c.sweep)})`);
  out.mock = resolveMocks(c.mock, cwd, 'mock');
  out.mockFrom = (c.mockFrom === undefined || c.mockFrom === null ? [] : Array.isArray(c.mockFrom) ? c.mockFrom : [c.mockFrom]).map((f) => resolve(cwd, String(f)));
  // roles, or the older form auth: { roles, …settings shared by every role }
  const authRoles = c.auth && typeof c.auth === 'object' && c.auth.roles !== undefined;
  if (authRoles && c.roles) throw new Error('renderlint: set "roles" or "auth.roles", not both');
  const { roles: aliased, ...sharedAuth } = authRoles ? c.auth : {};
  out.auth = normalizeAuth(authRoles ? null : c.auth);
  out.roles = authRoles ? normalizeRoles(aliased, sharedAuth, null, cwd, 'auth.roles') : normalizeRoles(c.roles, c.auth, out.auth, cwd, 'roles');
  if (out.params !== undefined && (typeof out.params !== 'object' || out.params === null || Array.isArray(out.params))) throw new Error('renderlint: "params" must map a route or parameter to values: { "/users/:id": ["7"], "slug": "hello-world" }');
  if (!Array.isArray(out.states)) throw new Error('renderlint: "states" must be an array of { name, page, click, … }');
  out.states = out.states.map((st, i) => {
    if (!st || typeof st !== 'object' || !st.name) throw new Error(`renderlint: states[${i}] needs a "name"`);
    return { ...st, mock: resolveMocks(st.mock, cwd, `states[${i}].mock`) };
  });
  if (out.dedupe === 'true' || out.dedupe === 'identical' || out.dedupe === undefined) out.dedupe = true;
  if (out.dedupe === 'false' || out.dedupe === 'off') out.dedupe = false;
  if (![true, false, 'template'].includes(out.dedupe)) throw new Error(`renderlint: "dedupe" must be true, false or "template" (got ${JSON.stringify(c.dedupe)})`);
  if (!['error', 'warn', 'never'].includes(out.failOn)) throw new Error(`renderlint: "failOn" must be error | warn | never`);
  return out;
}

// roles: { admin: { …auth settings, mock, pages, deny } }. A role's sign-in: its own "auth" (null: signed out),
// the auth settings on the role over the top-level "auth", or (none on the role) the top-level "auth" itself.
// Its mocks go over the top-level ones, in the browser and on the server.
function normalizeRoles(roles, shared, fallback, cwd, where) {
  if (roles === undefined || roles === null || roles === false) return null;
  if (typeof roles !== 'object' || Array.isArray(roles) || !Object.keys(roles).length) throw new Error(`renderlint: "${where}" must map role names to their settings, e.g. { "admin": { "storage": …, "pages": ["/admin"] }, "viewer": { … } }`);
  const out = {};
  for (const [name, r] of Object.entries(roles)) {
    if (!/^[\w.-]+$/.test(name)) throw new Error(`renderlint: role name "${name}" may only use letters, digits, "_", "-" and "."`);
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error(`renderlint: ${where}.${name} must be an object: { storage | login, mock, pages, deny }`);
    const { auth, mock, pages: p, deny, ...fields } = r;
    const pages = p === undefined ? [] : typeof p === 'string' ? p.split(',') : p;
    if (!Array.isArray(pages)) throw new Error(`renderlint: ${where}.${name}.pages must be a list of paths`);
    if (deny !== undefined && !(Array.isArray(deny) && deny.every((d) => typeof d === 'string'))) throw new Error(`renderlint: ${where}.${name}.deny must be a list of paths such as "/admin/**"`);
    const own = 'auth' in r ? normalizeAuth(auth, `${where}.${name}.auth`)
      : Object.keys(fields).length || where === 'auth.roles' ? normalizeAuth({ ...(shared && typeof shared === 'object' ? shared : {}), ...fields }, `${where}.${name}`)
        : fallback;
    out[name] = { auth: own, mock: resolveMocks(mock, cwd, `${where}.${name}.mock`), pages, deny: deny || [] };
  }
  return out;
}

// "pattern": "file.json" serves a file (relative to the project); anything else is served as JSON.
function resolveMocks(mock, cwd, where) {
  if (mock === undefined || mock === null) return {};
  if (typeof mock !== 'object' || Array.isArray(mock)) throw new Error(`renderlint: "${where}" must map URL patterns to responses`);
  const out = {};
  for (const [pattern, v] of Object.entries(mock)) out[pattern] = typeof v === 'string' && /\.json$/i.test(v) ? { file: resolve(cwd, v) } : v && typeof v === 'object' && typeof v.file === 'string' ? { ...v, file: resolve(cwd, v.file) } : withJwts(v);
  return out;
}

// { "$jwt": claims } anywhere in inline mock data becomes an unsigned token (a mocked login API that returns one).
function withJwts(v) {
  if (Array.isArray(v)) return v.map(withJwts);
  if (!v || typeof v !== 'object') return v;
  if (v.$jwt && Object.keys(v).length === 1) return forgeJwt(v.$jwt);
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withJwts(x)]));
}

function defaultHeight(w) { return w <= 480 ? 812 : w <= 900 ? 1024 : 800; }
