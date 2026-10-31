# Angular

Covers standalone and NgModule apps, guards (`canActivate`, `canMatch`), `HttpInterceptor`, lazy routes, hash routing (`withHashLocation()`), and Angular SSR.

## Single-page app (`ng serve`, `ng build`)

Route guards and `HttpClient` run in the browser, so renderlint needs no backend: set what the guard reads, and answer the API with `mock`.

```json
{
  "serve": "npm start",
  "auth": { "storage": { "sessionStorage": { "acme.token": "test-token" } } },
  "roles": {
    "admin":  { "mock": { "**/api/me": { "name": "Ada Admin", "role": "admin" } } },
    "viewer": { "mock": { "**/api/me": { "name": "Vic Viewer", "role": "viewer" } }, "deny": ["/admin/**"] }
  },
  "mock": {
    "**/api/accounts": "fixtures/accounts.json",
    "**/api/accounts/*": "fixtures/account.json"
  }
}
```

- **The token key:** look for `sessionStorage.setItem` / `localStorage.setItem` in the auth service. NgRx state persisted to storage is just a JSON value: `"localStorage": { "auth": { "token": "t", "user": { "role": "admin" } } }`.
- **A guard that decodes a JWT** (`@auth0/angular-jwt`, `jwt-decode`, with an expiry check): use `{ "$jwt": { "sub": "1", "role": "admin" } }` as the value. renderlint writes an unsigned token that expires in 2100.
- **Routes** are read from `Routes` arrays in the source, including lazy `loadChildren` and `RouterModule.forChild`. They are also read from the running router, on `ng serve` and on production builds. Pages reached only by a button are found too.
- **Dynamic routes** (`accounts/:id`) get values from links, the API data the app received, or `"params": { "/accounts/:id": ["a1"] }`.
- **Production build:** `ng build`, then `npx renderlint dist/<project>/browser`, or `"dir": "dist/<project>/browser"` in the config. renderlint serves the folder with SPA fallback. Routes are still read from the running router; route coverage from the source needs a URL target, e.g. `--serve "npx serve -s dist/<project>/browser -l 4319" --url http://localhost:4319`.

Tested on Angular 19 and 22 standalone apps: role from `/api/me`, a guard redirecting a viewer, an "Access denied" page, `/users/:id`, a button-only page. Every page was checked as every role, on `ng serve` and on the production build, with no backend.

## SSR

Angular SSR (`@angular/ssr`) renders on the server. With `provideHttpClient(withFetch())`, the server's requests go through `fetch`, and renderlint's [server mocks](../server-mocks.md) answer them.

```json
{
  "serve": "NG_ALLOWED_HOSTS=localhost npx ng serve --port 4319",
  "url": "http://localhost:4319",
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "roles": {
    "admin":  { "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "role": "admin" } }, "**/api/me": { "role": "admin" } }, "pages": ["/admin"] },
    "viewer": { "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "role": "viewer" } }, "**/api/me": { "role": "viewer" } }, "deny": ["/admin/**"] }
  },
  "mock": { "**/api/tasks": "fixtures/tasks.json" }
}
```

- **Angular 20.3 and later** only render on the server for allowed hosts. Without `NG_ALLOWED_HOSTS=localhost` (or `allowedHosts` in `angular.json`), it silently falls back to client-only rendering.
- **Production:** `"serve": "NG_ALLOWED_HOSTS=localhost PORT=4319 node dist/<project>/server/server.mjs"`.
- **Node 20.19 or later** is needed by Angular 20.
- Tested on Angular 20 SSR (`ng serve` and the Express server): guards, `REQUEST`, `HttpClient` with `withFetch()`. Each role's planted defects were found with no backend, and a viewer sent to `/admin` was reported, not passed.

## Not covered

- SSR with an `HttpClient` that doesn't use `withFetch()` wasn't tested. The server mocks also intercept `node:http`, but treat it as unverified.
- Routes with custom `matcher` functions can't be read from the source. The running router lists them, but values for their parameters must come from `params` or links.
