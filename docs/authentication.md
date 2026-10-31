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

Admin-only pages, a viewer's read-only banner, an "upgrade" card only free users see: each role renders a different UI. List the roles and renderlint checks every page as each of them, in one run, with no backend:

```json
{
  "pages": ["/"],
  "auth": {
    "roles": {
      "admin":  { "storage": { "localStorage": { "token": { "$jwt": { "sub": "1", "role": "admin" } } } } },
      "viewer": { "storage": { "localStorage": { "token": { "$jwt": { "sub": "2", "role": "viewer" } } } }, "deny": ["/admin/**"] }
    }
  },
  "mock": { "**/api/users": "fixtures/users.json", "**/api/users/*": "fixtures/user.json" }
}
```

- **A role** takes anything `auth` takes (`storage`, `login`, `run`), plus its own `mock` (on top of the top-level one) and `deny`. Settings next to `roles` are shared by all roles.
- **Where the role comes from** decides what to set:
  - `/api/me` (or any user endpoint): the same token for everyone, and a mock per role: `"admin": { "mock": { "**/api/me": { "name": "Ada", "role": "admin" } } }`, with the shared `"storage": { "sessionStorage": { "token": "test" } }` next to `roles`.
  - JWT claims decoded in the frontend: `{ "$jwt": { …claims } }` makes an unsigned token that expires in 2100. It works as a storage value, inside a persisted store's JSON, as a cookie value, and in inline mocks (a mocked login API returning `{ "token": { "$jwt": … } }`).
  - A persisted store (Pinia, Redux, NgRx, Zustand): the store's JSON as the value, `"localStorage": { "auth": { "token": "t", "user": { "role": "viewer" } } }`.
  - A login form: shared `"login": "/login", "user": …, "password": …` with a per-role mock of the login API, or each role with its own credentials.
- **Every page:** renderlint reads the route table from the app's router (Vue Router, React Router, Angular Router) at runtime, dev server or production build, and checks every route, including pages reached only with a button. Dynamic routes (`/users/:id`) get a value from a link on a checked page, else from the API data (`/api/users` → the first user's `id`), else from `params`: `"params": { "/users/:id": ["7"] }`. Routes it can't fill are listed as not checked. `"routes": false` turns this off.
- **Pages a role isn't shown** are reported, never checked in that role's name: a guard that redirects (`/admin` → `/dashboard`), or "Access denied" / "Page not found" rendered in place. A page one role sees and another doesn't is a `page-not-shown` warning for the other; list it in that role's `deny` (globs: `/admin`, `/admin/**`) and it is recorded as denied as expected instead. Ordinary redirects (`/` → `/dashboard`, `/settings` → `/settings/profile`, trailing slashes) are not findings.

The report starts with the coverage, page by page and role by role:

```
Coverage (routes from the vue router):
  route              admin    viewer
  /admin             checked  denied (expected)
  /billing           checked  Access denied
  /dashboard         checked  checked
  /users/7           checked  checked
```

Findings name the role (`/dashboard [role: viewer]`), screenshots too (`dashboard-…-viewer@375.png`). `report.json` has the same table under `coverage`. With one session (no `roles`), the same detection applies: a page you listed that the app doesn't show is an error, a crawled one a warning.

## Crawling a signed-in app

- Log out links (`/logout`, `/sign-out`, `#/logout`…) are never followed, and with `auth` the login page isn't crawled either.
- Hash routes (`/#/accounts`, Angular `withHashLocation()`) are pages of their own.
- A crawled page that sends renderlint back to the login page (an admin-only route for a non-admin user, for example) is a warning; a page you listed is an error. Turn the rule off with `"rules": { "auth-required": "off" }`.
- If listed pages are reported with "The session from "auth" was not accepted here", the token was set but rejected: an expired JWT, a key the guard doesn't read, or an API call that answered 401. Mock that call, or check the key.

## Coding agents

Agents set up by `renderlint init` are told to handle `auth-required` with option 1: find the key the guard reads, set a test value, and mock the API calls the pages make. No credentials are needed.
