// A small SPA with the routes of src/router/index.js: dynamic routes, an API list, a role guard that
// renders "Access denied" at the same URL, a page that sends you to the login, and a route nothing links to.
const app = document.getElementById('app');
const nav = '<nav><a href="/">Home</a><a href="/about">About</a><a href="/admin">Admin</a><a href="/settings">Settings</a></nav>';
const routes = [
  [/^\/$/, async () => {
    const users = await (await fetch('/api/users.json')).json();
    app.innerHTML = `${nav}<h1>Shop</h1><ul>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<li><a href="/products/${i}">Product ${i}</a></li>`).join('')}</ul><p>${users.items.length} members</p>`;
  }],
  [/^\/about$/, () => { app.innerHTML = `${nav}<h1>About us</h1><p>We make things.</p>`; }],
  [/^\/products\/([^/]+)$/, async (id) => {
    const list = await (await fetch('/api/products.json')).json();
    const p = list.find((x) => x.id === id);
    app.innerHTML = `${nav}<h1>${p ? p.name : 'Product ' + id}</h1><p>Price on request.</p>`;
  }],
  [/^\/users\/([^/]+)$/, (id) => { app.innerHTML = `${nav}<h1>Member ${id}</h1>`; }],
  [/^\/admin$/, () => { app.innerHTML = `${nav}<h1>Access denied</h1><p>You need the admin role to see this page.</p>`; }],
  [/^\/settings$/, () => { location.replace('/login'); }],
  [/^\/reports\/([^/]+)$/, (id) => { app.innerHTML = `${nav}<h1>Report ${id}</h1>`; }],
  [/^\/login$/, () => { app.innerHTML = '<h1>Sign in</h1><form><label>Email <input type="email" autocomplete="username"></label> <label>Password <input type="password"></label> <button>Sign in</button></form>'; }],
];
const m = routes.map(([re, fn]) => [re.exec(location.pathname), fn]).find(([x]) => x);
if (m) m[1](...m[0].slice(1)); else app.innerHTML = `${nav}<h1>Page not found</h1>`;
