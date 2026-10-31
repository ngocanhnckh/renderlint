// Server-side mocks for apps that fetch on the server (Next.js server components and
// getServerSideProps, Nuxt useFetch/server routes, SvelteKit and React Router loaders,
// Angular SSR). renderlint preloads this file into the app's server process when it starts it:
//
//   NODE_OPTIONS="--require <renderlint>/src/server-mock.cjs" RENDERLINT_SERVER_MOCK=<plan.json> npm run dev
//
// It answers the server's outgoing requests (global fetch, which Next.js, ofetch/Nuxt,
// SvelteKit and React Router all use, and node:http/https, which axios, got and node-fetch use)
// that match a pattern in the plan with the mocked response; everything else goes out as usual.
// The response can depend on the role the browser request is for: renderlint sends a
// "renderlint-role" cookie with every page request of a role, and each incoming request is
// handled in an AsyncLocalStorage context that remembers it, so a fetch made while rendering
// that request (however deep, after any await) gets the role's mocks. A "renderlint-stress"
// cookie lengthens the strings in JSON responses (renderlint's data stress, server side).
// Every outgoing request is logged (JSON lines) with the run id from a "renderlint-run" cookie,
// so renderlint can tell which server calls a page made and which of them failed.
//
// CommonJS and dependency-free, so `--require` works in every Node version renderlint supports,
// in child processes (next dev, nuxi) and in worker threads (Nuxt's dev server) alike.
'use strict';
const http = require('node:http');
const https = require('node:https');
const { readFileSync, appendFileSync, statSync } = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');

const PLAN_FILE = process.env.RENDERLINT_SERVER_MOCK;
const KEY = Symbol.for('renderlint.serverMock');

if (PLAN_FILE && !globalThis[KEY]) install();

function install() {
  const als = new AsyncLocalStorage();
  let plan = { mock: {}, roles: {}, states: {} }, planMtime = '';
  // Re-read when renderlint rewrites the plan (a later role, a state's mocks).
  const current = () => {
    try {
      const st = statSync(PLAN_FILE), m = st.mtimeMs + ':' + st.size;
      if (m !== planMtime) { plan = JSON.parse(readFileSync(PLAN_FILE, 'utf8')); planMtime = m; }
    } catch { /* keep the last plan */ }
    return plan;
  };
  current();
  globalThis[KEY] = { als, plan: current };

  const cookie = (header, name) => {
    const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]*)').exec(header || '');
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  // Only requests renderlint's browser makes to this machine are answered from mocks: one from another
  // host, or addressed to a non-loopback host name, goes to the real network (a server reachable from
  // outside, or a preload left in a deployed environment, never serves test data to real visitors).
  const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|::ffff:127(?:\.\d{1,3}){3}|[\w-]+\.localhost)$/i;
  const fromLoopback = (req) => {
    const remote = String((req.socket && req.socket.remoteAddress) || '');
    const host = String((req.headers && req.headers.host) || '').replace(/:\d+$/, '');
    return (!remote || LOOPBACK.test(remote)) && (!host || LOOPBACK.test(host));
  };
  let warned = false;
  const contextOf = (req) => {
    const h = req.headers || {};
    if (!fromLoopback(req)) {
      if (!warned) { warned = true; process.stderr.write('[renderlint server-mock] a request from or to a non-loopback host: not mocked\n'); }
      return { off: true, page: req.url };
    }
    return {
      role: h['x-renderlint-role'] || cookie(h.cookie, 'renderlint-role'),
      state: h['x-renderlint-state'] || cookie(h.cookie, 'renderlint-state'),
      stress: +(h['x-renderlint-stress'] || cookie(h.cookie, 'renderlint-stress')) || 0,
      run: h['x-renderlint-run'] || cookie(h.cookie, 'renderlint-run'),
      page: req.url,
    };
  };
  // Incoming requests: handle each in a context that knows its role.
  for (const Server of [http.Server, https.Server]) {
    const emit = Server.prototype.emit;
    Server.prototype.emit = function (event, req) {
      if (event === 'request' && req && req.headers && !req.headers['x-renderlint-mock-url']) {
        const ctx = contextOf(req);
        // an untagged request the server makes to itself while rendering keeps the outer context
        if (ctx.off || ctx.role || ctx.state || ctx.run || ctx.stress || !als.getStore()) return als.run(ctx, () => emit.apply(this, arguments));
      }
      return emit.apply(this, arguments);
    };
  }

  const glob = (pattern, str) => new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(str);
  // The app's own origin is never mocked: a request to it reaches the app's own route (Next.js
  // fetching its RSC payload, a dev server's proxy hop), whose outgoing calls are mocked in turn.
  const local = (h) => h.replace(/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/, 'localhost');
  const isSelf = (u, p) => (p.self || []).some((o) => { try { const s = new URL(o); return s.port === u.port && local(s.hostname) === local(u.hostname); } catch { return false; } });
  const lookup = (url, ctx) => {
    let u;
    try { u = new URL(url); } catch { return null; }
    const p = current();
    if (ctx && ctx.off) return null;
    if (isSelf(u, p)) return null;
    const tables = [ctx && ctx.state && p.states && p.states[ctx.state], ctx && ctx.role && p.roles && p.roles[ctx.role], p.mock].filter(Boolean);
    for (const table of tables) {
      for (const [pattern, v] of Object.entries(table)) {
        if (!glob(pattern, u.href) && !glob(pattern, u.pathname + u.search)) continue;
        if (v && typeof v === 'object' && !Array.isArray(v) && ('file' in v || 'status' in v || 'json' in v || 'body' in v)) return v;
        return { data: v };
      }
    }
    return null;
  };
  const render = (spec) => {
    const isJson = spec.file ? /\.json$/i.test(spec.file) : typeof spec.body !== 'string';
    const body = spec.file ? readFileSync(spec.file, 'utf8') : spec.body !== undefined ? (typeof spec.body === 'string' ? spec.body : JSON.stringify(spec.body)) : JSON.stringify(spec.json !== undefined ? spec.json : spec.data);
    return { status: spec.status || 200, headers: { 'content-type': isJson ? 'application/json' : 'text/plain', ...(spec.headers || {}) }, body, isJson };
  };
  let stressJson = null;
  const stressed = async (text, factor) => {
    if (!stressJson) stressJson = (await import('./stress-data.js')).stressJson;
    try { return JSON.stringify(stressJson(JSON.parse(text), factor)); } catch { return text; }
  };
  const log = (entry) => {
    const p = current();
    if (!p.log) return;
    try { appendFileSync(p.log, JSON.stringify({ t: Date.now(), ...entry }) + '\n'); } catch { /* ignore */ }
  };

  // global fetch (undici): ofetch (Nuxt), SvelteKit's and React Router's loaders call it. Next.js
  // replaces it with its own (the data cache), so whatever is assigned to globalThis.fetch later is
  // wrapped again, and only the outermost wrapper of a call acts: mocked and stressed responses never reach
  // Next's data cache, which would otherwise hand one role's mocked data to another and keep it on
  // disk (.next/cache/fetch-cache) after renderlint is done.
  const answer = async (inner, thisArg, args) => {
    const ctx = als.getStore();
    if (ctx && ctx.through) return Reflect.apply(inner, thisArg, args); // an inner layer of a call already handled
    const [input, init] = args;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    const method = String((init && init.method) || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    const spec = url ? lookup(url, ctx) : null;
    const base = { run: ctx && ctx.run, role: ctx && ctx.role, page: ctx && ctx.page, method, url, via: 'fetch', ...(ctx && ctx.stress ? { stress: ctx.stress } : {}) };
    if (spec) {
      const r = render(spec);
      const body = r.isJson && ctx && ctx.stress ? await stressed(r.body, ctx.stress) : r.body;
      log({ ...base, mocked: true, status: r.status, json: r.isJson });
      const res = new Response(r.status === 204 || r.status === 304 ? null : body, { status: r.status, headers: r.headers });
      try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
      return res;
    }
    let res;
    try { res = await als.run({ ...(ctx || {}), through: true }, () => Reflect.apply(inner, thisArg, args)); } catch (e) {
      log({ ...base, mocked: false, error: String((e && e.cause && (e.cause.code || e.cause.message)) || (e && e.message) || e) });
      throw e;
    }
    const json = /json/.test((res.headers && res.headers.get('content-type')) || '');
    log({ ...base, mocked: false, status: res.status, json });
    if (json && ctx && ctx.stress && res.status < 300) {
      const text = await stressed(await res.text(), ctx.stress);
      const headers = new Headers(res.headers);
      headers.delete('content-length'); headers.delete('content-encoding');
      return new Response(text, { status: res.status, statusText: res.statusText, headers });
    }
    return res;
  };
  // A Proxy keeps the wrapped function's own properties (Next's __nextPatched, _nextOriginalFetch).
  const wrapFetch = (inner) => {
    return new Proxy(inner, { apply: (target, thisArg, args) => answer(target, thisArg, args) });
  };
  const realFetchForDispatcher = globalThis.fetch;
  if (typeof globalThis.fetch === 'function') {
    let outer = wrapFetch(globalThis.fetch);
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true, enumerable: true,
      get: () => outer,
      set: (f) => { outer = typeof f === 'function' ? wrapFetch(f) : f; },
    });
  }

  // undici's global dispatcher, which Node's fetch sends every request through: also reaches fetch
  // implementations that don't go through globalThis.fetch (the undici package, a bundled copy of it such
  // as Next.js's edge runtime for middleware). Node creates it on the first fetch, so make one (a data:
  // URL, no network) and wrap it. Calls the fetch layer above already handled pass straight through.
  const DISPATCHER = Symbol.for('undici.globalDispatcher.1');
  const answerDispatch = (opts, handler, ctx, spec, url) => {
    (async () => {
      const r = render(spec);
      const body = Buffer.from(r.isJson && ctx && ctx.stress ? await stressed(r.body, ctx.stress) : r.body);
      log({ run: ctx && ctx.run, role: ctx && ctx.role, page: ctx && ctx.page, method: String(opts.method || 'GET').toUpperCase(), url, via: 'undici', mocked: true, status: r.status, json: r.isJson });
      const headers = { ...r.headers, 'content-length': String(body.length) };
      if (typeof handler.onResponseStart === 'function') { // undici 7 handler API
        const controller = { abort() {}, pause() {}, resume() {}, aborted: false, paused: false, reason: null };
        if (handler.onRequestStart) handler.onRequestStart(controller, {});
        handler.onResponseStart(controller, r.status, headers, '');
        handler.onResponseData(controller, body);
        handler.onResponseEnd(controller, {});
      } else {
        if (handler.onConnect) handler.onConnect(() => {});
        handler.onHeaders(r.status, Object.entries(headers).flatMap(([k, v]) => [Buffer.from(k), Buffer.from(String(v))]), () => {}, '');
        handler.onData(body);
        handler.onComplete([]);
      }
    })().catch((e) => { try { (handler.onError || handler.onResponseError).call(handler, e); } catch { /* ignore */ } });
    return true;
  };
  const wrapDispatcher = (real) => new Proxy(real, {
    get(target, key) {
      if (key === 'dispatch') {
        return (opts, handler) => {
          const ctx = als.getStore();
          let url = null;
          try { url = new URL(opts.path, opts.origin).href; } catch { /* not a URL */ }
          const spec = !(ctx && ctx.through) && url ? lookup(url, ctx) : null;
          return spec ? answerDispatch(opts, handler, ctx, spec, url) : target.dispatch(opts, handler);
        };
      }
      const v = Reflect.get(target, key, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  if (typeof realFetchForDispatcher === 'function') {
    realFetchForDispatcher('data:,').catch(() => {}).finally(() => {
      const real = globalThis[DISPATCHER];
      if (real && typeof real.dispatch === 'function') {
        try { globalThis[DISPATCHER] = wrapDispatcher(real); } catch { /* not writable */ }
      }
    });
  }

  // node:http / node:https (axios, got, node-fetch): a mocked request is sent to a local server that answers it.
  let mockPort = null;
  const mockServer = http.createServer(async (req, res) => {
    const url = req.headers['x-renderlint-mock-url'];
    const ctx = { role: req.headers['x-renderlint-role'] || undefined, state: req.headers['x-renderlint-state'] || undefined, stress: +req.headers['x-renderlint-stress'] || 0 };
    const spec = lookup(url, ctx);
    if (!spec) { res.writeHead(502); return res.end(); }
    const r = render(spec);
    const body = r.isJson && ctx.stress ? await stressed(r.body, ctx.stress) : r.body;
    res.writeHead(r.status, r.headers);
    res.end(body);
  });
  mockServer.listen(0, '127.0.0.1', () => { mockPort = mockServer.address().port; });
  mockServer.unref();
  const httpRequest = http.request;
  const wrap = (mod, proto) => {
    const request = mod.request;
    const patched = function (a, b, c) {
      let url, opts, cb;
      if (typeof a === 'string' || a instanceof URL) { url = new URL(a); if (typeof b === 'function') cb = b; else { opts = b; cb = c; } }
      else { opts = a; cb = b; }
      opts = opts || {};
      if (opts.socketPath) return request.apply(this, arguments); // local IPC (Nuxt's dev server talking to its worker)
      const href = url ? url.href : `${opts.protocol || proto}//${opts.hostname || opts.host || 'localhost'}${opts.port ? ':' + opts.port : ''}${opts.path || '/'}`;
      const ctx = als.getStore();
      const spec = mockPort && lookup(href, ctx);
      if (!spec) return request.apply(this, arguments);
      log({ run: ctx && ctx.run, role: ctx && ctx.role, page: ctx && ctx.page, method: (opts.method || 'GET').toUpperCase(), url: href, via: 'http', mocked: true, status: spec.status || 200 });
      const headers = { ...(opts.headers || {}), 'x-renderlint-mock-url': href };
      if (ctx && ctx.role) headers['x-renderlint-role'] = ctx.role;
      if (ctx && ctx.state) headers['x-renderlint-state'] = ctx.state;
      if (ctx && ctx.stress) headers['x-renderlint-stress'] = String(ctx.stress);
      return httpRequest({ method: opts.method || 'GET', headers, host: '127.0.0.1', port: mockPort, path: '/', agent: false }, cb);
    };
    mod.request = patched;
    mod.get = function (a, b, c) { const req = patched(a, b, c); req.end(); return req; };
  };
  wrap(http, 'http:');
  wrap(https, 'https:');
}
