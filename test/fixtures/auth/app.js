// A signed-in app in the shape of an Angular/React SPA: a route guard reads a token from
// sessionStorage, the API wants it in a header, and the inner pages only render with it.
const hashMode = document.documentElement.dataset.router === 'hash';
const app = document.getElementById('app');
const token = () => sessionStorage.getItem('demo.token');
const route = () => (hashMode ? location.hash.replace(/^#/, '') || '/' : location.pathname).split('?')[0];
const go = (path, replace) => {
  if (hashMode) { replace ? location.replace('#' + path) : (location.hash = path); return; }
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
};
const href = (path) => (hashMode ? '#' + path : path);
const api = async (path, init = {}) => {
  const r = await fetch(path, { ...init, headers: { authorization: 'Bearer ' + token(), 'content-type': 'application/json' } });
  if (r.status === 401) { sessionStorage.removeItem('demo.token'); go('/login', true); throw new Error('signed out'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
};
const nav = () => `<nav><a href="${href('/dashboard')}">Dashboard</a><a href="${href('/reports')}">Reports</a><a href="${href('/logout')}">Log out</a></nav>`;

const pages = {
  '/login': () => {
    app.innerHTML = `<main class="login"><h1>Sign in</h1><form>
      <label>Email <input type="email" name="email" autocomplete="username"></label>
      <label>Password <input type="password" name="password" autocomplete="current-password"></label>
      <p class="error" role="alert" hidden></p>
      <button type="submit">Sign in</button></form></main>`;
    app.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email: e.target.email.value }) });
      if (!r.ok) { const p = app.querySelector('.error'); p.hidden = false; p.textContent = 'Wrong email or password.'; return; }
      sessionStorage.setItem('demo.token', (await r.json()).token);
      go('/dashboard');
    });
  },
  '/dashboard': async () => {
    const me = await api('/api/me');
    app.innerHTML = `${nav()}<main><h1>Welcome back, ${me.name}</h1>
      <section class="card"><h2>Your plan</h2><span class="badge">Enterprise annual plan</span></section></main>`;
  },
  '/reports': async () => {
    const reports = await api('/api/reports');
    app.innerHTML = `${nav()}<main><h1>Reports</h1><ul>${reports.map((r) => `<li>${r.title}</li>`).join('')}</ul></main>`;
  },
  '/logout': () => { sessionStorage.removeItem('demo.token'); go('/login', true); },
};

async function render() {
  const path = route();
  if (path === '/') return go('/dashboard', true);
  if (path !== '/login' && !token()) return go('/login', true); // the route guard
  app.innerHTML = '';
  try { await (pages[path] || (() => { app.innerHTML = '<main><h1>Not found</h1></main>'; }))(); } catch { /* sent to the login page */ }
}
addEventListener('popstate', render);
addEventListener('hashchange', render);
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || hashMode) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
render();
