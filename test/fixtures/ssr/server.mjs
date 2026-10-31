// A server-rendered app in the shape of Next.js / SvelteKit / Remix: the login, the role check and
// the data fetching all happen on the server, against an external API that is NOT running in the
// tests (API_URL points at a closed port). Only renderlint's server-side mocks make its pages render.
//   node server.mjs   (PORT=0 picks a free port; prints "Local: http://localhost:<port>")
import { createServer, get } from 'node:http';

const API = process.env.API_URL || 'http://127.0.0.1:4599/api';
const css = `body{font-family:sans-serif;margin:0;background:#fff;color:#111}
nav{display:flex;gap:16px;padding:12px 16px;background:#f3f4f6}nav a{color:#1d4ed8}
main{padding:16px}form{display:grid;gap:12px;max-width:320px}label{display:grid;gap:4px}
input{font:inherit;padding:8px;border:1px solid #888;border-radius:6px}
button{font:inherit;padding:8px 14px;border:0;border-radius:6px;background:#1d4ed8;color:#fff}
.title{display:inline-block;width:150px;white-space:nowrap;font-size:14px;padding:2px 6px;border-radius:4px;background:#e0f2fe;color:#075985}
/* Planted defects on the role-only pages */
.plan{display:inline-block;width:90px;white-space:nowrap;padding:4px 8px;border-radius:999px;background:#ede9fe;color:#5b21b6}
.status{display:inline-block;width:80px;white-space:nowrap;padding:4px 8px;border-radius:6px;background:#fef3c7;color:#92400e}`;

const page = (title, user, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>${css}</style></head><body>
<nav><a href="/dashboard">Dashboard</a>${user && user.role === 'admin' ? '<a href="/admin">Admin</a>' : ''}${user && user.role === 'viewer' ? '<a href="/tasks">My tasks</a>' : ''}${user ? '<a href="/logout">Log out</a>' : '<a href="/login">Sign in</a>'}</nav>
<main>${body}</main></body></html>`;

// Like Next.js, the framework wraps fetch with a data cache for requests marked "force-cache" (keyed by
// URL only here, so every role's /me is the same request): mocked responses must never land in it.
const frameworkFetch = globalThis.fetch, dataCache = new Map();
globalThis.fetch = async (url, init = {}) => {
  if (init.cache !== 'force-cache') return frameworkFetch(url, init);
  if (!dataCache.has(String(url))) { const r = await frameworkFetch(url, init); dataCache.set(String(url), { status: r.status, headers: [...r.headers], body: await r.text() }); }
  const c = dataCache.get(String(url));
  return new Response(c.body, { status: c.status, headers: c.headers });
};

// fetch() for most calls, node:http for one (as axios or got would)
async function api(path, token) {
  const r = await fetch(API + path, { headers: { authorization: 'Bearer ' + token }, ...(path === '/me' ? { cache: 'force-cache' } : {}) });
  if (!r.ok) throw new Error('API ' + path + ': ' + r.status);
  return r.json();
}
const apiHttp = (path, token) => new Promise((resolve, reject) => {
  get(API + path, { headers: { authorization: 'Bearer ' + token } }, (res) => {
    let b = '';
    res.on('data', (d) => { b += d; });
    res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, html, headers = {}) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers }); res.end(html); };
  const go = (to, headers = {}) => { res.writeHead(303, { location: to, ...headers }); res.end(); };
  try {
    if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      for await (const c of req) body += c;
      const f = new URLSearchParams(body);
      const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) }).catch(() => null);
      if (!r || !r.ok) return send(401, page('Sign in', null, '<h1>Sign in</h1><p class="error" role="alert">Invalid email or password.</p>'));
      return go('/dashboard', { 'set-cookie': `sid=${(await r.json()).token}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (url.pathname === '/login') {
      return send(200, page('Sign in', null, `<h1>Sign in</h1><form method="post" action="/login">
        <label>Email <input type="email" name="email" autocomplete="username"></label>
        <label>Password <input type="password" name="password" autocomplete="current-password"></label>
        <button type="submit">Sign in</button></form>`));
    }
    if (url.pathname === '/') return send(200, page('Acme', null, '<h1>Acme analytics</h1><p>Sign in to see your dashboard.</p>'));
    // everything else: signed in, the API says who the token belongs to
    const token = (/(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '') || [])[1];
    const me = token ? await api('/me', token).catch(() => null) : null;
    if (!me) return go('/login?next=' + encodeURIComponent(url.pathname));
    if (url.pathname === '/dashboard') {
      const reports = await api('/reports', token);
      return send(200, page('Dashboard', me, `<h1>Welcome back, ${me.name}</h1><ul>${reports.map((r) => `<li><span class="title">${r.title}</span></li>`).join('')}</ul>`));
    }
    if (url.pathname === '/admin') {
      if (me.role !== 'admin') return go('/403');
      const users = await api('/admin/users', token);
      return send(200, page('Admin', me, `<h1>Admin: users</h1><ul>${users.map((u) => `<li>${u.name} <span class="plan">${u.plan}</span></li>`).join('')}</ul>`));
    }
    if (url.pathname === '/tasks') {
      if (me.role !== 'viewer') return go('/dashboard');
      const tasks = await apiHttp('/tasks', token);
      return send(200, page('My tasks', me, `<h1>My tasks</h1><ul>${tasks.map((t) => `<li>${t.title} <span class="status">${t.status}</span></li>`).join('')}</ul>`));
    }
    if (url.pathname === '/403') return send(200, page('Access denied', me, '<h1>Access denied</h1><p>You need another role for this page.</p>'));
    if (url.pathname === '/billing') return send(200, page('Billing', me, `<h1>Billing</h1><p>${(await api('/billing', token)).plan}</p>`));
    return send(404, page('Not found', me, '<h1>Not found</h1>'));
  } catch (e) {
    return send(500, page('Error', null, '<h1>Something went wrong</h1>'));
  }
});
server.listen(+process.env.PORT || 0, '127.0.0.1', () => console.log(`Local: http://localhost:${server.address().port}/`));
