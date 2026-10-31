// Every page of a single-page app, not only the linked ones: the route table is read from the
// app's own router at runtime (Vue Router, React Router data/framework routers and <Routes>,
// Angular Router), dynamic segments are filled in, and a page that the app did not show
// (redirected by a guard, "Access denied" or "Page not found" in its place) is told apart from
// a page that was checked.

// Angular production builds expose no debug API. The Router reads its config with
// `inject(ROUTES)?.flat()`, so this init script keeps the first route table it sees pass through
// Array.prototype.flat (observing only: the result is returned unchanged).
export const NG_ROUTES_HOOK = () => {
  if (window.__rl_ngRoutesHook) return;
  window.__rl_ngRoutesHook = true;
  const flat = Array.prototype.flat;
  const KEYS = ['component', 'loadComponent', 'children', 'loadChildren', 'redirectTo', 'canActivate', 'matcher'];
  const isRoute = (r) => r && typeof r === 'object' && !Array.isArray(r) && (typeof r.path === 'string' || typeof r.matcher === 'function');
  const looksLikeRoutes = (a) => a.length > 0 && a.length < 5000 && a.every(isRoute) && a.some((r) => KEYS.some((k) => k in r));
  function patched() {
    const out = flat.apply(this, arguments);
    try { if (!window.__rl_ngRoutes && Array.isArray(out) && looksLikeRoutes(out)) window.__rl_ngRoutes = out; } catch (e) { /* ignore */ }
    return out;
  }
  try { Object.defineProperty(patched, 'toString', { value: () => flat.toString(), configurable: true, writable: true }); } catch (e) { /* ignore */ }
  try { Object.defineProperty(Array.prototype, 'flat', { value: patched, configurable: true, writable: true, enumerable: false }); } catch (e) { /* ignore */ }
};

// In the page: { framework, prefix, routes: [{ path, page, redirect, catchAll, lazy }] } or null.
// `prefix` turns a route path into a URL (origin + prefix + path): "/#" for hash routers,
// "/app" for a base path, "" otherwise.
export const DISCOVER_ROUTES = async () => {
  const join = (base, p) => (p && p.startsWith('/') ? p : ((base || '').replace(/\/$/, '') + '/' + (p || '')).replace(/\/+/g, '/'));
  const clean = (p) => (p.length > 1 ? p.replace(/\/$/, '') : p) || '/';
  // only a splat on its own is a catch-all ("*", "**", "/:pathMatch(.*)*"); "admin/*" is the /admin section
  const isCatchAll = (p) => /^\/?(\*\*|\*|:[\w-]+\(\.\*\)[*+]?)$/.test(p);
  const hashed = /^#!?\//.test(location.hash);
  const out = (framework, routes, prefix) => ({ framework, prefix, routes: routes.map((r) => ({ ...r, path: clean(r.path), catchAll: isCatchAll(r.path) })) });

  // Vue 3: app.mount() leaves the app on its container (dev and production builds)
  const vueEl = document.querySelector('[data-v-app]') || Array.from(document.querySelectorAll('body, body > *')).find((e) => e.__vue_app__);
  const vueRouter = vueEl && vueEl.__vue_app__ && vueEl.__vue_app__.config.globalProperties.$router;
  if (vueRouter && typeof vueRouter.getRoutes === 'function') {
    let prefix = '';
    try { prefix = new URL(vueRouter.resolve('/__rl__').href, location.href).href.replace(location.origin, '').replace(/\/__rl__$/, ''); } catch (e) { /* default */ }
    const routes = vueRouter.getRoutes().map((r) => ({ path: r.path, page: !r.redirect && !!r.components && Object.keys(r.components).length > 0 && !(r.children && r.children.some((c) => c.path === '')), redirect: !!r.redirect, lazy: false }));
    return out('vue', routes, prefix);
  }

  // React Router framework mode / Remix: the route manifest is global
  const manifest = window.__reactRouterManifest || window.__remixManifest;
  if (manifest && manifest.routes) {
    const all = manifest.routes, full = (r) => (r.parentId && all[r.parentId] ? join(full(all[r.parentId]), r.path || '') : join('/', r.path || ''));
    const routes = Object.values(all).filter((r) => r.id !== 'root').map((r) => {
      const kids = Object.values(all).some((c) => c.parentId === r.id);
      return { path: full(r), page: !!(r.index || !kids), redirect: false, lazy: false };
    });
    return out('react-router', routes, (window.__reactRouterContext && window.__reactRouterContext.basename || '').replace(/\/$/, ''));
  }

  // React Router data routers (createBrowserRouter/createHashRouter + RouterProvider) and <Routes>:
  // the router is a prop in the fiber tree, reachable from the root container (dev and production)
  const rootEl = [document.body, ...document.querySelectorAll('body > *, body > * > *')].find((e) => e && Object.keys(e).some((k) => k.startsWith('__reactContainer$')));
  if (rootEl) {
    const key = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$'));
    let router = window.__reactRouterDataRouter || null, declared = null, n = 0;
    // the container holds the first HostRoot fiber; the committed tree is its FiberRoot's `current`
    const hostRoot = rootEl[key];
    const stack = [(hostRoot && hostRoot.stateNode && hostRoot.stateNode.current) || hostRoot];
    // <Route> elements: their props say path/index; a pathless layout <Route element> is one by its type
    const kids = (c) => (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x) => x && typeof x === 'object' && x.props);
    const routeTypes = new Set();
    const isRouteEl = (c) => routeTypes.has(c.type) || (('path' in c.props || 'index' in c.props) && ('element' in c.props || 'Component' in c.props || 'children' in c.props || 'lazy' in c.props) && routeTypes.add(c.type));
    while (stack.length && !router && n < 20000) {
      const f = stack.pop(); n++;
      if (!f) continue;
      const p = f.memoizedProps;
      if (p && p.router && Array.isArray(p.router.routes) && typeof p.router.navigate === 'function') { router = p.router; break; }
      if (!declared && p && p.children && kids(p.children).some(isRouteEl)) declared = kids(p.children).filter(isRouteEl);
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    const fromElements = (els) => els.map((e) => ({ path: e.props.path, index: !!e.props.index, element: e.props.element, Component: e.props.Component, lazy: e.props.lazy, loader: e.props.loader, children: e.props.children ? fromElements(kids(e.props.children).filter(isRouteEl)) : [] }));
    const tree = router ? router.routes : declared ? fromElements(declared) : null;
    if (tree) {
      const routes = [];
      const walk = (list, base) => {
        for (const r of list) {
          const p = r.index ? base : r.path === undefined ? base : join(base, r.path);
          const children = r.children || [];
          // <Navigate to> as the element is a redirect
          const navigates = r.element && r.element.props && typeof r.element.props.to === 'string' && !r.element.props.children;
          const renders = !!(r.element || r.Component || r.lazy) && !navigates;
          if (children.length) {
            // a layout: its own URL is a page only through an index child
            walk(children, p);
          } else if (r.path !== undefined || r.index) {
            routes.push({ path: p, page: renders, redirect: navigates || (!renders && !!r.loader), lazy: !!r.lazy });
          }
        }
      };
      walk(tree, '/');
      let prefix = hashed ? location.pathname + location.search + '#' : '';
      try { if (router && router.createHref) prefix = router.createHref({ pathname: '/__rl__', search: '', hash: '' }).replace(/\/__rl__$/, ''); } catch (e) { /* default */ }
      if (prefix && !prefix.startsWith('/') && !prefix.startsWith('#')) prefix = '/' + prefix;
      if (prefix.startsWith('#')) prefix = location.pathname + prefix;
      return out('react-router', routes, prefix === '/' ? '' : prefix);
    }
  }

  // Angular: the Router through the dev-mode debug API, a RouterLink's router, or (production) the hook above
  const ngRoot = document.querySelector('[ng-version]');
  if (ngRoot) {
    const ng = window.ng;
    let config = null;
    try { const r = ng && ng.ɵgetRouterInstance && ng.ɵgetRouterInstance(ng.getInjector(ngRoot)); if (r && Array.isArray(r.config)) config = r.config; } catch (e) { /* older Angular */ }
    if (!config && ng && ng.getDirectives) {
      for (const el of document.querySelectorAll('a[href], [routerlink], [ng-reflect-router-link]')) {
        const d = (ng.getDirectives(el) || []).find((x) => x && x.router && Array.isArray(x.router.config));
        if (d) { config = d.router.config; break; }
      }
    }
    if (!config && Array.isArray(window.__rl_ngRoutes)) config = window.__rl_ngRoutes;
    if (config) {
      const routes = [];
      const walk = async (list, base, depth) => {
        for (const r of list) {
          if (!r || typeof r.path !== 'string') { if (r && r.matcher) routes.push({ path: join(base, '(custom matcher)'), page: false, redirect: false, lazy: false, matcher: true }); continue; }
          const p = join(base, r.path);
          if (r.redirectTo !== undefined) { routes.push({ path: p, page: false, redirect: true, lazy: false }); continue; }
          let children = r.children || r._loadedRoutes || null;
          if (!children && r.loadChildren && depth < 4) {
            // standalone lazy routes: loadChildren: () => import('./admin.routes').then((m) => m.routes)
            try {
              let v = await Promise.race([r.loadChildren(), new Promise((res) => setTimeout(() => res(null), 3000))]);
              if (v && v.default) v = v.default;
              if (Array.isArray(v)) children = v;
            } catch (e) { /* not loadable here */ }
            if (!children) { routes.push({ path: p, page: false, redirect: false, lazy: true }); continue; }
          }
          const renders = !!(r.component || r.loadComponent);
          const hasEmptyChild = (children || []).some((c) => c && c.path === '');
          if (renders && !hasEmptyChild) routes.push({ path: p, page: true, redirect: false, lazy: !!r.loadComponent });
          if (children) await walk(children, p, depth + 1);
        }
      };
      await walk(config, '/', 0);
      let prefix = '';
      if (hashed) prefix = location.pathname + location.search + '#';
      else { try { prefix = new URL(document.baseURI).pathname.replace(/\/$/, ''); } catch (e) { /* default */ } }
      return out('angular', routes, prefix);
    }
  }
  return null;
};

const PARAM = /:([A-Za-z_][\w-]*)(\([^)]*\))?([?*+])?|(^|\/)(\*)$/g;

// The route paths worth checking as pages: rendered routes, no redirects, catch-alls or log-out routes.
export function pagePatterns(discovered, { skip = () => false } = {}) {
  const seen = new Set();
  const out = [];
  for (const r of discovered.routes) {
    if (!r.page || r.catchAll || r.redirect) continue;
    // optional segments: the page without them
    const path = r.path.replace(/\/:[\w-]+(\([^)]*\))?\?/g, '').replace(/\/[^/:]+\?(?=\/|$)/g, '').replace(/\/(\*\*?)$/, '') || '/';
    if (seen.has(path) || skip(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

export const paramNames = (pattern) => Array.from(pattern.matchAll(PARAM)).map((m) => m[1] || '*');
export const isDynamic = (pattern) => paramNames(pattern).length > 0;

// /users/:id → ^/users/([^/]+)$
export function patternRegex(pattern) {
  let re = '', last = 0;
  for (const m of pattern.matchAll(PARAM)) {
    re += pattern.slice(last, m.index).replace(/[.+?^${}()|[\]\\]/g, '\\$&') + (m[4] || '') + (m[5] || m[3] === '*' || m[3] === '+' ? '(.+)' : '([^/]+)');
    last = m.index + m[0].length;
  }
  re += pattern.slice(last).replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + re + '/?$');
}

function fill(pattern, values) {
  let i = 0;
  return pattern.replace(PARAM, (m, name, re, mod, slash) => (slash !== undefined && m.endsWith('*') && !name ? slash : '') + encodeURIComponent(String(values[i++])).replace(/%2F/g, '/'));
}

// Values for a dynamic route's parameters, in this order: the config ("params"), links seen on
// checked pages, then the API data the app received (or the mocks): for /users/:id, the "id" of the
// first item of a JSON list from a URL with "users" in it. Returns { paths, from } or { missing }.
export function fillParams(pattern, { params = {}, links = [], data = [], max = 1 } = {}) {
  const names = paramNames(pattern);
  const given = params[pattern] !== undefined ? params[pattern] : names.length === 1 ? (params[names[0]] ?? params[':' + names[0]]) : undefined;
  if (given !== undefined) {
    const list = (Array.isArray(given) ? given : [given]).slice(0, Math.max(max, Array.isArray(given) ? given.length : 1));
    return { paths: list.map((v) => (typeof v === 'string' && v.startsWith('/') ? v : fill(pattern, typeof v === 'object' && v ? names.map((n) => v[n]) : [v]))), from: 'config' };
  }
  const re = patternRegex(pattern);
  const fromLinks = Array.from(new Set(links.filter((l) => re.test(l)))).slice(0, max);
  if (fromLinks.length) return { paths: fromLinks, from: 'links' };
  if (names.length === 1 && names[0] !== '*') {
    const name = names[0];
    const before = pattern.split(':' + name)[0].split('/').filter((s) => s && !s.startsWith(':')).pop();
    if (before) {
      const fields = [name, /Id$/.test(name) ? 'id' : null, name === 'id' ? 'uuid' : null, name === 'slug' ? 'handle' : null].filter(Boolean);
      const segs = new Set([before, before.replace(/s$/, ''), before + 's', before.replace(/ies$/, 'y'), before.replace(/y$/, 'ies')]);
      const values = [];
      for (const { url, json } of data) {
        const parts = String(url).split(/[/?#&=*]+/);
        if (!parts.some((s) => segs.has(s))) continue;
        for (const list of listsIn(json)) {
          for (const item of list) {
            const f = fields.find((k) => item && (typeof item[k] === 'string' || typeof item[k] === 'number') && String(item[k]).length && String(item[k]).length < 200);
            if (f) values.push(item[f]);
            if (values.length >= max) break;
          }
          if (values.length) break;
        }
        if (values.length >= max) break;
      }
      if (values.length) return { paths: Array.from(new Set(values)).slice(0, max).map((v) => fill(pattern, [v])), from: 'data' };
    }
  }
  return { missing: names };
}

// Arrays of objects at the top of a JSON response or one level down ({ data: [...] }, { items: [...] }).
function listsIn(json) {
  const isList = (v) => Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (isList(json)) return [json];
  if (json && typeof json === 'object') return Object.values(json).filter(isList);
  return [];
}

// In the page: an "Access denied" / "Page not found" screen rendered in place of the page.
// Only a short heading (h1/h2, or the document title) that *starts* with such a phrase counts,
// and only on a page with little content, so a page about permissions isn't taken for one.
export const NOT_SHOWN_SCRIPT = () => {
  const DENIED = /^(?:error\s*)?40[13]\b|^(?:access|permission)\s+(?:denied|forbidden|restricted)\b|^forbidden\b(?!\s+\w+\s+\w)|^(?:not|un)\s?authori[sz]ed\b|^you\s+(?:do not|don't|are not allowed|aren't allowed|are not authori[sz]ed|aren't authori[sz]ed|need (?:permission|access)|lack)\b|^(?:insufficient|missing)\s+(?:permissions?|privileges|rights|access)\b|^no\s+(?:access|permission)\b|^restricted\s+(?:area|access|page)\b|^admins? only\b/i;
  const NOT_FOUND = /^(?:error\s*)?404\b|^(?:page|route|resource)\s+not\s+found\b|^not\s+found\b|^(?:this|the)\s+page\s+(?:doesn't|does not|could not|couldn't|can't|cannot)\s+(?:exist|be found)|^(?:sorry,?\s+)?(?:we\s+)?(?:couldn't|could not|can't|cannot)\s+find\s+(?:that|this|the)\s+page|^page\s+(?:doesn't|does not)\s+exist|^nothing\s+(?:here|to see here)\b/i;
  const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const text = (e) => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main, [role="main"]') || document.body;
  if (!main) return null;
  let content = main.innerText || '';
  if (main === document.body) for (const e of document.body.querySelectorAll('nav, header, footer, [role="navigation"], [role="banner"], [role="contentinfo"]')) content = content.replace(e.innerText || '', '');
  if (content.replace(/\s+/g, ' ').trim().length > 600) return null;
  // the page's own heading: the first visible h1 (or, without one, the first h2), never a section further down
  const first = (sel) => Array.from(document.querySelectorAll(sel)).find(vis);
  const head = first('h1, [role="heading"][aria-level="1"]') || first('h2, [role="heading"][aria-level="2"]');
  for (const t of [head ? text(head) : '', (document.title || '').trim()]) {
    if (!t || t.length > 80) continue;
    if (DENIED.test(t)) return { kind: 'denied', text: t };
    if (NOT_FOUND.test(t)) return { kind: 'not-found', text: t };
  }
  return null;
};

// The route of a URL: the hash route for hash routers (/#/users), otherwise the path; without a
// trailing slash, index.html or query.
export function routeOf(u) {
  let x;
  try { x = new URL(u); } catch { return u; }
  const h = /^#!?\//.test(x.hash) ? x.hash.replace(/^#!?/, '').split('?')[0] : null;
  let p = h !== null ? h : x.pathname.replace(/\/index\.html?$/, '/');
  try { p = decodeURI(p); } catch { /* keep */ }
  return p.length > 1 ? p.replace(/\/+$/, '') : p;
}

// Was the page asked for shown, or did the app go elsewhere? Ordinary redirects aren't
// "elsewhere": a trailing slash, index.html, the query, and a section's default child
// (/settings → /settings/profile).
export function redirectedTo(asked, landed) {
  let a, b;
  try { a = new URL(asked); b = new URL(landed); } catch { return null; }
  if (a.origin !== b.origin) return b.origin + b.pathname;
  const ra = routeOf(asked), rb = routeOf(landed);
  // a hash app asked for without a hash route (/ or /app.html) lands on its start route
  const askedHash = /^#!?\//.test(a.hash), landedHash = /^#!?\//.test(b.hash);
  if (!askedHash && landedHash && a.pathname === b.pathname) return null;
  if (ra.toLowerCase() === rb.toLowerCase()) return null;
  if (ra !== '/' && rb.startsWith(ra + '/')) return null; // a section's default child route
  // a locale prefix added or dropped: /dashboard → /en/dashboard, /de-DE/dashboard → /dashboard
  const LOCALE = /^\/[a-z]{2}(?:[-_][A-Za-z]{2,4})?(?=\/|$)/;
  if (ra !== '/' && rb !== '/' && (rb.replace(LOCALE, '') === ra || ra.replace(LOCALE, '') === rb)) return null;
  return rb;
}

const ERROR_PAGE = /^\/(errors?\/)?(40[134]|50\d|forbidden|unauthori[sz]ed|access-denied|denied|no-access|not-allowed|not-found|notfound|error)(\/|$)/i;
const ROOT = (u) => { try { const x = new URL(u); return routeOf(u) === '/' || (/\.html?$/.test(x.pathname) && !/^#!?\//.test(x.hash)); } catch { return false; } };

// Turns each page's outcome for every role into findings. `outcomes` maps a page key to
// { url, route, source: 'listed'|'role'|'route'|'router'|'link'|'landed'|'params', page: bool (a rendered route in the
// router config), roles: { [role]: null (shown) | { kind: 'redirect'|'denied'|'not-found', to, text } } }.
// Rules: a page one role sees and another doesn't is "not shown" for the other (expected when listed in
// that role's `deny`); a page no role sees is reported when there is a reason to believe it is a page
// (listed, a rendered route in the router config, or an access-denied / not-found screen). A redirect
// every role takes the same way, from a page found by crawling, is an ordinary redirect.
export function notShownFindings(outcomes, { roles, deny = {}, multi }) {
  const findings = [];
  for (const o of outcomes) {
    const shownBy = roles.filter((r) => o.roles[r] === null);
    const missed = roles.filter((r) => o.roles[r] && o.roles[r].kind !== 'unstable'); // unstable: shown at some viewports only (a flaky render): no evidence either way
    if (!missed.length) continue;
    // the app's own error page (/403, /forbidden, a guard's landing page) shows "Access denied" by design
    if (!shownBy.length && !Object.values(o.listedFor || {}).some(Boolean) && (o.source === 'landed' || ERROR_PAGE.test(o.route))) continue;
    const alias = !shownBy.length && missed.every((r) => o.roles[r].kind === 'redirect' && o.roles[r].to === o.roles[missed[0]].to);
    for (const r of missed) {
      const why = o.roles[r];
      if (why.kind === 'login') { (o.reported = o.reported || {})[r] = true; continue; } // reported as auth-required
      const own = !!(o.listedFor && o.listedFor[r]); // one of the role's own "pages": it must see it
      const expected = !own && (deny[r] || []).some((p) => globLike(p, o.route));
      let report, severity = 'warn';
      if (shownBy.length || own) report = true;
      else if (why.kind !== 'redirect') report = true;
      else if (o.source === 'listed') report = !ROOT(o.url);
      else if (o.page && o.source === 'router') report = !ROOT(o.url); // a rendered route nobody is shown (a home route may forward)
      else report = false;
      if (alias && !own && o.source !== 'listed' && !(o.page && o.source === 'router')) report = false;
      if (!report) continue;
      if (expected) { o.expected = o.expected || {}; o.expected[r] = true; continue; }
      (o.reported = o.reported || {})[r] = true;
      if ((o.source === 'listed' && !shownBy.length) || own) severity = 'error';
      const who = multi ? ` for role "${r}"` : '';
      const reason = why.kind === 'redirect' ? `the app redirected to ${why.to}` : why.status ? `the server answered HTTP ${why.status}` : `the app showed "${why.text}" in its place`;
      const seen = shownBy.length ? ` (role${shownBy.length > 1 ? 's' : ''} ${shownBy.map((x) => `"${x}"`).join(', ')} ${shownBy.length > 1 ? 'see' : 'sees'} it)` : '';
      const hint = own
        ? `It is in roles.${r}.pages: give the role a session the page accepts (roles.${r}.auth) and the data that grants it (roles.${r}.mock, e.g. the user/session API answering with this role).`
        : shownBy.length
        ? `If "${r}" isn't meant to see it, list it in roles.${r}.deny; otherwise check that role's storage and mocks.`
        : o.source === 'params' ? 'The value used for its parameters may not exist: set "params" in renderlint.config.'
          : 'Check the session (storage, mocks) or the route guard.';
      findings.push({ rule: 'page-not-shown', severity, role: multi ? r : undefined, url: o.url,
        message: `${o.route} was not checked${who}: ${reason}${seen}. ${hint}`,
        details: { route: o.route, role: multi ? r : undefined, kind: why.kind, to: why.to, text: why.text, ...(why.status ? { status: why.status } : {}), source: o.source } });
    }
  }
  return findings;
}

// "/admin", "/admin/*", "/admin/**": * and ** match anything, including slashes.
export function globLike(pattern, path) {
  const re = new RegExp('^' + String(pattern).split(/\*+/).map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '/?$');
  return re.test(path) || re.test(path + '/');
}
