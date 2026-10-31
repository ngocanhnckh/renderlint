# Pages behind a login

Most of an app's UI is behind a login: dashboards, tables, settings, account pages. Without a session, an Angular, React or Vue app sends every one of those routes to `/login`, so the login form is all that renders.

renderlint notices this. A page you asked for that lands on a login page (or on an identity provider such as Entra ID, Auth0, Okta or Keycloak) is reported as `auth-required` instead of being checked:

```
✖ auth-required (2)  A page renderlint was asked to check sent it to a login page or identity provider instead…
  error /dashboard was not checked: the app sent renderlint to /login instead. Pages behind a login need "auth" in renderlint.config …
```

The login page itself is still checked, under its own name. Give renderlint a session with `auth`. There are three ways, and the first needs no backend at all.

## 1. Frontend only: no backend, no credentials (recommended)

A route guard only checks that a token exists; it can't tell a test value from a real one. Set the token the guard reads, and serve the API calls the pages make with `mock`. This checks the UI with nothing but the dev server running, works the same in CI, and the data is stable from run to run.

An Angular app whose `AuthService` stores the token in `sessionStorage`, with a `CanActivate` guard and an `HttpInterceptor`:

```json
{
  "serve": "npm start",
  "pages": ["/dashboard", "/accounts", "/settings"],
  "auth": { "storage": { "sessionStorage": { "acme.token": "test-token" } } },
  "mock": {
    "**/api/me": { "name": "Dana Whitfield", "role": "admin" },
    "**/api/accounts": "fixtures/accounts.json",
    "**/api/accounts/*": "fixtures/account.json"
  }
}
```

- **Which key?** Look for `sessionStorage.setItem` / `localStorage.setItem` in the auth service, or sign in once and look under Application > Storage in the browser's DevTools. NgRx, Redux or Pinia persisted state is just a JSON value, so put it in as an object: `"localStorage": { "auth": { "token": "test", "user": { "id": 1 } } }`.
- **Cookie sessions:** `"storage": { "cookies": [{ "name": "session", "value": "test" }] }`. This works when the frontend only checks that the cookie exists; an `HttpOnly` session cookie is checked by the server, so use a login or a backend.
- **Which endpoints?** The pages' network calls in DevTools (Fetch/XHR) list them. A JSON file path, inline data, or `{ "status": 500, "json": { … } }` for an error. Unmocked calls go to the real network as usual. See [states and mocks](configuration.md#states-and-mocks).
- **Data to catch bugs with:** put realistic worst cases in the fixtures (a long company name, a 60-character email, an empty list). renderlint already re-checks every JSON response with longer strings (`stressData`).
- **JWT:** a guard that decodes the token (`jwt-decode`, `@auth0/angular-jwt` with an expiry check) needs a well-formed one. Make an unsigned token with a far-off `exp`, e.g. `node -e "const b=(o)=>Buffer.from(JSON.stringify(o)).toString('base64url');console.log(b({alg:'none'})+'.'+b({sub:'1',exp:4102444800})+'.')"`.

`${NAME}` in `auth` values is read from the environment.

## 2. Log in with the real form

renderlint fills in the login form once, then reuses the session (cookies, localStorage, sessionStorage and IndexedDB) for every page and width:

```json
{
  "auth": { "login": "/login", "user": "${RENDERLINT_USER}", "password": "${RENDERLINT_PASSWORD}" }
}
```

```bash
RENDERLINT_USER=qa@example.com RENDERLINT_PASSWORD=… npx renderlint
```

Keep credentials in environment variables (or CI secrets), not in the config file. Use a test account. The defaults find the usual fields (email or user name, password, a submit button). For anything else, give the selectors:

```json
{
  "auth": {
    "login": {
      "page": "/account/sign-in",
      "fill": { "#username": "${RENDERLINT_USER}", "#password": "${RENDERLINT_PASSWORD}", "#tenant": "acme" },
      "submit": "button.sign-in",
      "waitFor": "/home"
    }
  }
}
```

`waitFor` is a path renderlint waits to reach, or a selector to wait for; by default it waits until the app leaves the login page. If the login fails, the run stops with what the form said ("Invalid password") and a screenshot in `.renderlint/screens/login-failed.png`.

This also works against a mocked login API, `"mock": { "**/api/auth/login": { "token": "test" } }`, if you want the real login code path without a backend.

## 3. Anything else: SSO, MFA, magic links (JS config)

```js
// renderlint.config.mjs
export default {
  auth: {
    run: async (page, { baseUrl }) => {
      await page.goto(baseUrl + '/login');
      await page.getByRole('button', { name: 'Sign in with Microsoft' }).click();
      await page.getByLabel('Email').fill(process.env.RENDERLINT_USER);
      // …the identity provider's steps; renderlint saves whatever session this leaves
      await page.waitForURL('**/dashboard');
    },
  },
};
```

`run` gets a Playwright page and can do anything a test can. It runs once per renderlint run. A saved session from Playwright works too: `npx playwright codegen --save-storage=.auth/state.json http://localhost:4200`, then `"contextOptions": { "storageState": ".auth/state.json" }` (add `.auth/` to `.gitignore`; it doesn't hold sessionStorage, so token-in-sessionStorage apps need option 1 or 2).

## Every page as every role

Admin-only pages, a viewer's read-only banner, an "upgrade" card only free users see: each role renders a different UI. List the roles and renderlint checks every page as each of them, all roles at once, in one run, with no backend:

```json
{
  "pages": ["/"],
  "roles": {
    "admin":  { "storage": { "localStorage": { "token": { "$jwt": { "sub": "1", "role": "admin" } } } }, "pages": ["/admin"] },
    "viewer": { "storage": { "localStorage": { "token": { "$jwt": { "sub": "2", "role": "viewer" } } } }, "deny": ["/admin/**"] }
  },
  "mock": { "**/api/users": "fixtures/users.json", "**/api/users/*": "fixtures/user.json" }
}
```

- **A role** takes anything `auth` takes (`storage`, `login`, `user`, `password`, `run`), over the top-level `auth`, which holds what all roles share. A role with none of them uses the top-level `auth` as is; `"auth": null` on a role checks it signed out, and `"auth": { … }` on a role replaces the top-level one. Plus:
  - `mock`: its API responses, over the top-level `mock` (in the browser, and on the server for SSR apps).
  - `pages`: pages it must see. They are checked as that role, and one the app doesn't show it is a `page-not-shown` error.
  - `deny`: paths it is not meant to see (globs: `/admin`, `/admin/**`).
  - The older form `"auth": { "roles": { … }, …shared settings }` works too.
- **Where the role comes from** decides what to set:
  - `/api/me` (or any user endpoint): the same token for everyone, and a mock per role: `"admin": { "mock": { "**/api/me": { "name": "Ada", "role": "admin" } } }`, with the shared `"auth": { "storage": { "sessionStorage": { "token": "test" } } }`.
  - JWT claims decoded in the frontend: `{ "$jwt": { …claims } }` makes an unsigned token that expires in 2100. It works as a storage value, inside a persisted store's JSON, as a cookie value, and in inline mocks (a mocked login API returning `{ "token": { "$jwt": … } }`).
  - A persisted store (Pinia, Redux, NgRx, Zustand): the store's JSON as the value, `"localStorage": { "auth": { "token": "t", "user": { "role": "viewer" } } }`.
  - A login form: a shared `"auth": { "login": "/login", "user": …, "password": … }` with a per-role mock of the login API, or each role with its own credentials (`"admin": { "user": "${ADMIN_USER}", "password": "${ADMIN_PASSWORD}" }`).
- **Every page:** the routes come from the app's source first (see `routes` in [configuration](configuration.md)). renderlint also reads the route table from the app's router (Vue Router, React Router, Angular Router) at runtime, dev server or production build, and checks every route, including pages reached only with a button. Dynamic routes (`/users/:id`) get a value from `params`, the build, a link on a checked page, or the API data (`/api/users` → a user's `id`): `"params": { "/users/:id": ["7"] }`. Routes it can't fill are listed as not checked. `"routes": false` turns this off.
- **Pages a role isn't shown** are reported, never checked in that role's name: a guard that redirects (`/admin` → `/dashboard` or `/403`), an HTTP 401/403, or "Access denied" / "Page not found" rendered in place. A page one role sees and another doesn't is a `page-not-shown` warning for the other; list it in that role's `deny` and it is recorded as denied as expected instead. Ordinary redirects (`/` → `/dashboard`, `/settings` → `/settings/profile`, trailing slashes, a locale prefix, a redirect every role takes the same way) are not findings. A redirect to the login page is `auth-required`: the role's session wasn't accepted.

The report shows every page role by role:

```
Pages by role (routes from the vue router):
  route              admin    viewer
  /admin             checked  denied (expected)
  /billing           checked  Access denied
  /dashboard         checked  checked
  /users/7           checked  checked
```

Findings name the role (`/dashboard [role: viewer]`), screenshots too (`dashboard-…-viewer@375.png`). `report.json` has the same table under `roleCoverage`. With one session (no `roles`), the same detection applies: a page you listed that the app doesn't show is an error, a crawled one a warning.

## Server-rendered apps (Next.js, Nuxt, SvelteKit, React Router / Remix)

In an SSR app the session check and the data fetching run on the server: `middleware.ts`, Auth.js, `getServerSideProps`, server components, Nuxt `useFetch` and server routes, SvelteKit `hooks.server` and `+page.server` loads, React Router loaders. A browser-side `mock` never reaches them. When renderlint starts the app (`serve`, or the `dev` script it finds on its own), it loads a small preload into the server process (`NODE_OPTIONS=--require …/server-mock.cjs`), and `mock` then also answers the requests the **server** makes: `fetch` (which Next.js, ofetch/Nuxt, SvelteKit, React Router and Angular's `withFetch()` use), undici's global dispatcher (the `undici` package, Next.js `middleware.ts` on the edge runtime) and `node:http`/`https` (axios, got). Nothing else about the app changes, nothing is written into its build output, and no backend has to run.

So the real login form works without a backend: the app's own auth code (Auth.js `authorize`, an iron-session, `nuxt-auth-utils` or React Router cookie session, a token cookie) runs as usual, and the API call that checks the password is answered by a mock (any password works; write it as `"${RENDERLINT_PASSWORD}"` all the same, so no literal password sits in the config). Sessions are minted by the app itself, so no secret is needed.

```json
{
  "serve": "npm run dev",
  "pages": ["/dashboard"],
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "mock": { "**/api/reports": "fixtures/reports.json" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "name": "Ada", "role": "admin" } }, "**/api/me": { "name": "Ada", "role": "admin" } } },
    "viewer": { "pages": ["/tasks"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "name": "Vic", "role": "viewer" } }, "**/api/me": { "name": "Vic", "role": "viewer" } } }
  }
}
```

- The server knows which role a request is for from a `renderlint-role` cookie renderlint sends with every request of that role: the preload handles each incoming request in its own async context, so every server call made while rendering it (after any `await`) gets that role's mocks, while all roles run at once.
- An SSR page that fails (HTTP 500) because a server request isn't mocked says which one: `The server's own requests failed: GET http://localhost:4501/api/billing (ECONNREFUSED)`. `report.json` lists every page's server requests (`pages[].server`).
- Data stress reaches server-rendered data: the reload with longer strings tells the preload (a `renderlint-stress` cookie) to lengthen the JSON the server fetched.
- Next.js: mocked responses never reach Next's data cache (`fetch(…, { cache: 'force-cache' })`), so one role can't get another's cached data, and nothing mocked is left in `.next/cache` after the run. Pages prerendered at `next build` keep their build-time data; dynamic pages (cookies, headers, `no-store`) use the mocks.
- A server you start yourself: run it with the preload, and it reads the mocks renderlint writes to `.renderlint/server-mock.json`:
  `NODE_OPTIONS="--require @ngocanhnckh/renderlint/server-mock" RENDERLINT_SERVER_MOCK=.renderlint/server-mock.json npm run dev`.
  Production builds work the same way (`next start`, `node .output/server/index.mjs`, `node build`, `react-router-serve`).
- Safety: the preload does nothing unless `RENDERLINT_SERVER_MOCK` is set, and it only answers requests that come to a loopback host (`localhost`, `127.0.0.1`, `::1`); a request from anywhere else gets the app's real behavior, with a warning on stderr. Never set it on a deployed server.
- `"serverMock": false` keeps `mock` browser-only. The app's own origin is never mocked on the server (its own routes, the dev server's internal hops).
- Not covered: servers that aren't Node (Django, Rails, Laravel, Go), and logins that check the password in the app's own database (no HTTP call to mock). For those, use test accounts against a seeded backend, or `auth.run`.

## Crawling a signed-in app

- Log out links (`/logout`, `/sign-out`, `#/logout`…) are never followed, and with `auth` the login page isn't crawled either.
- Hash routes (`/#/accounts`, Angular `withHashLocation()`) are pages of their own.
- A crawled page that sends renderlint back to the login page (an admin-only route for a non-admin user, for example) is a warning; a page you listed is an error. Turn the rule off with `"rules": { "auth-required": "off" }`.
- If listed pages are reported with "The session from "auth" was not accepted here", the token was set but rejected: an expired JWT, a key the guard doesn't read, or an API call that answered 401. Mock that call, or check the key.

## Coding agents

Agents set up by `renderlint init` are told to handle `auth-required` with option 1: find the key the guard reads, set a test value, and mock the API calls the pages make. No credentials are needed.
