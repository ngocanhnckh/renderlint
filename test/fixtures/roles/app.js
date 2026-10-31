// An admin app with two roles, in the runtime shape of each router renderlint reads routes from
// (<html data-fw="react|vue|angular">):
//   react    React Router data router, found through the fiber tree; history routing; the role is a
//            claim of a JWT in localStorage ("rr.token") decoded in the frontend; user rows open on click.
//   vue      Vue Router on the app container (__vue_app__); hash routing; the role comes from a persisted
//            Pinia store in localStorage ("vue.auth"); user rows are links.
//   angular  Angular Router through the dev-mode `ng` debug API; hash routing; the role comes from
//            GET /api/me, the token from sessionStorage ("ng.token").
// Every app: /admin is admin-only (the guard redirects to /dashboard), /billing renders "Access denied"
// in place for viewers, /export is reached only with a button, / and /settings redirect, /users/:id is dynamic.
const fw = document.documentElement.dataset.fw;
const hash = fw !== 'react';
const root = document.getElementById('app');
const route = () => (hash ? location.hash.replace(/^#/, '') || '/' : location.pathname).split('?')[0].replace(/(.)\/$/, '$1'); // routers ignore a trailing slash
const go = (path, replace) => {
  if (hash) { replace ? location.replace('#' + path) : (location.hash = path); return; }
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
};
const href = (p) => (hash ? '#' + p : p);

function claims() {
  try { const p = JSON.parse(atob(localStorage.getItem('rr.token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.exp * 1000 > Date.now() ? p : null; } catch { return null; }
}
async function me() {
  if (fw === 'react') return claims();
  if (fw === 'vue') { try { const s = JSON.parse(localStorage.getItem('vue.auth')); return s && s.token ? s.user : null; } catch { return null; } }
  const t = sessionStorage.getItem('ng.token');
  if (!t) return null;
  const r = await fetch('/api/me', { headers: { authorization: 'Bearer ' + t } });
  return r.ok ? r.json() : null;
}
const api = (p) => fetch(p).then((r) => r.json());

const nav = (u) => `<nav><a href="${href('/dashboard')}">Dashboard</a><a href="${href('/users')}">Users</a><a href="${href('/billing')}">Billing</a>${u.role === 'admin' ? `<a href="${href('/admin')}">Admin</a>` : ''}<a href="${href('/logout')}">Log out</a></nav>`;
const pages = {
  '/login': () => '<main><h1>Sign in</h1><form><label>Email <input type="email" autocomplete="username"></label><label>Password <input type="password"></label><button type="submit">Sign in</button></form></main>',
  '/dashboard': async (u) => {
    const s = await api('/api/stats');
    return `<main><h1>Welcome back, ${u.name}</h1><section class="card"><h2>This week</h2><p>${s.signups} sign-ups.</p><button type="button" id="export">Export data</button></section>` +
      (u.role === 'viewer' ? '<section class="card"><h2>Read-only access</h2><span class="upgrade-badge">Request editor access</span></section>' : '') + '</main>';
  },
  '/users': async () => {
    const list = await api('/api/users');
    return `<main><h1>Users</h1><ul class="list">${list.map((x) => `<li><span>${x.name}</span>${fw === 'vue' ? `<a href="${href('/users/' + x.id)}">Open</a>` : `<button type="button" data-open="${x.id}">Open</button>`}</li>`).join('')}</ul></main>`;
  },
  '/users/:id': async (u, id) => {
    const x = await api('/api/users/' + id);
    if (!x || !x.name) return '<main><h1>Page not found</h1><p>There is no such user.</p></main>';
    return `<main><h1>${x.name}</h1><section class="card"><span class="email-chip">${x.email}</span></section></main>`;
  },
  '/admin': () => '<main><h1>Admin console</h1><section class="card"><h2>Seats</h2><p class="admin-stat-caption">Renews on the 1st of every month</p></section></main>',
  '/billing': (u) => (u.role === 'admin'
    ? '<main><h1>Billing</h1><section class="card"><h2>Current plan</h2><span class="plan-pill">Enterprise annual plan</span></section></main>'
    : '<main><div class="denied"><h1>Access denied</h1><p>You don\'t have permission to view billing.</p></div></main>'),
  '/export': () => '<main><h1>Export data</h1><section class="card"><p class="export-hint">Large exports can take a few minutes</p></section></main>',
  '/settings/profile': (u) => `<main><h1>Your profile</h1><p>Signed in as ${u.name}.</p></main>`,
};

async function render() {
  const path = route();
  if (path === '/') return go('/dashboard', true);
  if (path === '/settings') return go('/settings/profile', true);
  if (path === '/logout') { localStorage.clear(); sessionStorage.clear(); return go('/login', true); }
  const u = path === '/login' ? null : await me();
  if (path !== '/login' && !u) return go('/login', true); // signed-in guard
  if (path === '/admin' && u.role !== 'admin') return go('/dashboard', true); // role guard
  const m = /^\/users\/([^/]+)$/.exec(path);
  const page = m ? pages['/users/:id'] : pages[path];
  const html = page ? await page(u, m && m[1]) : '<main><h1>Page not found</h1></main>';
  root.innerHTML = (u ? nav(u) : '') + html;
}
addEventListener('popstate', render);
addEventListener('hashchange', render);
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b && b.id === 'export') return go('/export');
  if (b && b.dataset.open) return go('/users/' + b.dataset.open);
  const a = e.target.closest('a');
  if (!a || hash) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

// --- what each framework leaves at runtime, as renderlint finds it -----------------------------------
const el = {}; // stands in for a rendered element / component
if (fw === 'react') {
  const routes = [
    { path: '/login', element: el },
    { path: '/logout', loader() {} },
    { id: 'root', path: '/', element: el, loader() {}, children: [
      { index: true, loader() {} },
      { path: 'dashboard', element: el },
      { path: 'users', element: el },
      { path: 'users/:id', element: el, loader() {} },
      { path: 'admin', element: el, loader() {} },
      { path: 'billing', element: el },
      { path: 'export', element: el },
      { path: 'settings', loader() {} },
      { path: 'settings/profile', element: el },
      { path: '*', element: el },
    ] },
  ];
  const router = { routes, basename: '/', navigate: (p) => go(p), createHref: (l) => l.pathname };
  root['__reactContainer$fixture'] = { memoizedProps: null, child: { memoizedProps: { router }, child: null, sibling: null }, sibling: null };
} else if (fw === 'vue') {
  const c = { default: el };
  const records = [
    { path: '/', redirect: '/dashboard' }, { path: '/login', components: c }, { path: '/dashboard', components: c },
    { path: '/users', components: c }, { path: '/users/:id', components: c }, { path: '/admin', components: c, meta: { role: 'admin' } },
    { path: '/billing', components: c }, { path: '/export', components: c }, { path: '/settings', redirect: '/settings/profile' },
    { path: '/settings/profile', components: c }, { path: '/logout', components: c }, { path: '/:pathMatch(.*)*', components: c },
  ];
  root.setAttribute('data-v-app', '');
  root.__vue_app__ = { config: { globalProperties: { $router: { getRoutes: () => records, resolve: (p) => ({ href: location.pathname + '#' + p }) } } } };
} else {
  const C = function Page() {};
  const config = [
    { path: 'login', component: C }, { path: 'logout', component: C },
    { path: '', canActivate: [() => true], children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: C }, { path: 'users', component: C }, { path: 'users/:id', component: C },
      { path: 'admin', component: C, canActivate: [() => true] }, { path: 'billing', component: C }, { path: 'export', component: C },
      { path: 'settings', children: [{ path: '', pathMatch: 'full', redirectTo: 'profile' }, { path: 'profile', component: C }] },
      { path: '**', component: C },
    ] },
  ];
  root.setAttribute('ng-version', '22.0.0');
  window.ng = { getInjector: () => ({}), ɵgetRouterInstance: () => ({ config, navigateByUrl: (u) => go(u) }) };
}
render();
