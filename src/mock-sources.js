// API responses from what the project already has, instead of writing renderlint mocks by hand:
//
//   "mockFrom": ["src/mocks/handlers.ts"]     the app's MSW handlers (msw 2.x), run by renderlint
//   "mockFrom": ["recordings/app.har"]        a HAR recorded against the real backend (DevTools
//                                             "Save all as HAR", Playwright recordHar…), replayed
//
// Both answer the page's requests through renderlint's own route handler, so the data stress
// (longer API data) and per-state "mock" overrides apply to them too, and no service worker or
// backend is needed. Requests they don't answer go to the network as usual.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// The project directory whose node_modules has `pkg`, looking up from `from`.
function projectWith(pkg, from) {
  for (let d = dirname(from); ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules', pkg, 'package.json'))) return d;
    if (dirname(d) === d) return null;
  }
}

// Imports the handlers module with the project's own msw (and esbuild, for TypeScript).
async function loadMsw(file) {
  const root = projectWith('msw', file);
  if (!root) throw new Error(`renderlint: "mockFrom": ${file} looks like MSW handlers, but msw isn't installed in this project`);
  // In the project's node_modules, so `import 'msw'` resolves to the project's copy.
  const cache = join(root, 'node_modules', '.cache', 'renderlint');
  mkdirSync(cache, { recursive: true });
  const entry = join(cache, `msw-${process.pid}-${Date.now()}.mjs`);
  const spec = './' + relative(cache, file).split('\\').join('/');
  const src = `export * as handlersModule from ${JSON.stringify(spec)};\n`;
  if (/\.(c|m)?js$/.test(file)) {
    writeFileSync(entry, src);
  } else {
    let esbuild;
    try { esbuild = createRequire(join(root, 'package.json'))('esbuild'); } catch {
      throw new Error(`renderlint: "mockFrom": ${file} is TypeScript; renderlint compiles it with the project's esbuild (Vite has it), which wasn't found. Install esbuild or point to a .js file.`);
    }
    const out = await esbuild.build({ stdin: { contents: src, resolveDir: cache, loader: 'js' }, bundle: true, format: 'esm', platform: 'node', packages: 'external', write: false, logLevel: 'silent' });
    writeFileSync(entry, out.outputFiles[0].text);
  }
  let mod;
  try { mod = await import(pathToFileURL(entry).href); } finally { rmSync(entry, { force: true }); }
  const m = mod.handlersModule;
  const handlers = m.handlers || (m.default && (Array.isArray(m.default) ? m.default : m.default.handlers)) || Object.values(m).find((v) => Array.isArray(v) && v.length && v[0] && typeof v[0].run === 'function');
  if (!Array.isArray(handlers)) throw new Error(`renderlint: "mockFrom": ${file} doesn't export its MSW handlers (export const handlers = [...])`);
  if (typeof handlers[0].run !== 'function') throw new Error('renderlint: "mockFrom" needs msw 2.x handlers (http.get(…), graphql.query(…))');
  return { kind: 'msw', file, handlers };
}

// The JSON responses of a HAR file, by method and URL.
function loadHar(file) {
  const har = JSON.parse(readFileSync(file, 'utf8'));
  const exact = new Map(), noQuery = new Map(), byPath = new Map();
  for (const e of (har.log && har.log.entries) || []) {
    const c = e.response && e.response.content;
    if (!c || !/json/i.test(c.mimeType || '') || !e.response.status) continue; // data, not the app's code
    const body = c.encoding === 'base64' ? Buffer.from(c.text || '', 'base64').toString('utf8') : (c.text || '');
    const u = new URL(e.request.url);
    const res = { status: e.response.status, contentType: c.mimeType, body };
    const m = e.request.method.toUpperCase();
    exact.set(m + ' ' + u.href, res); // later entries win: the state at the end of the recording
    noQuery.set(m + ' ' + u.origin + u.pathname, res);
    byPath.set(m + ' ' + u.pathname + u.search, res);
  }
  return { kind: 'har', file, exact, noQuery, byPath };
}

export async function loadMockSources(list) {
  const out = [];
  for (const file of list || []) {
    if (!existsSync(file)) throw new Error(`renderlint: "mockFrom": ${file} does not exist`);
    out.push(/\.har$/i.test(file) ? loadHar(file) : await loadMsw(file));
  }
  return out;
}

const safeOrigin = (u) => { try { const o = new URL(u).origin; return /^https?:/.test(o) ? o : null; } catch { return null; } };

// What MSW's getResponse() does, with the page's origin as the base for relative handler paths
// ("/api/me"), which outside a browser match nothing.
async function runHandlers(handlers, request, baseUrl) {
  for (const handler of handlers) {
    if (handler.isUsed && handler.options && handler.options.once) continue;
    const result = await handler.run({ request: request.clone(), requestId: Math.random().toString(16).slice(2), resolutionContext: { baseUrl } });
    if (!result || !result.response) continue;
    if (result.response.headers.get('x-msw-intention') === 'passthrough') return null;
    return result.response;
  }
  return null;
}

// The response the sources give for a Playwright request: { status, headers, body } or null.
export async function answerFrom(sources, req) {
  for (const s of sources) {
    if (s.kind === 'har') {
      const u = new URL(req.url()), m = req.method();
      const r = s.exact.get(m + ' ' + u.href) || s.noQuery.get(m + ' ' + u.origin + u.pathname) || s.byPath.get(m + ' ' + u.pathname + u.search);
      if (r) return { status: r.status, headers: { 'content-type': r.contentType }, body: r.body };
      continue;
    }
    const headers = { ...req.headers() };
    const body = /^(GET|HEAD)$/.test(req.method()) ? undefined : req.postDataBuffer() || undefined;
    const request = new Request(req.url(), { method: req.method(), headers, body });
    let res = null;
    try { res = await runHandlers(s.handlers, request, req.frame && req.frame() ? safeOrigin(req.frame().url()) || new URL(req.url()).origin : new URL(req.url()).origin); } catch { res = null; }
    if (!res) continue;
    if (res.type === 'error') return { abort: true };
    const h = {};
    res.headers.forEach((v, k) => { h[k] = v; });
    return { status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) };
  }
  return null;
}
