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

List the roles and renderlint checks every page as each of them, all roles at once, in one run, with no backend:

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

A role takes anything `auth` takes, plus its own `mock`, the `pages` it must see and the paths it must not (`deny`). Pages a role isn't shown are reported (`page-not-shown`), never checked in its name. The report shows a route × role table. See [roles and coverage](roles-and-coverage.md) for where the role comes from (a user endpoint, JWT claims, a persisted store, a login form), the detection rules, and the coverage report.

## Server-rendered apps (Next.js, Nuxt, SvelteKit, React Router / Remix, Angular SSR)

In an SSR app the session check and the data fetching run on the server, where a browser-side `mock` can't reach them. When renderlint starts the app, `mock` also answers the requests the **server** makes, so the real login form works without a backend: the app's own auth code mints the session, and only the API call that checks the password is mocked. No secret is needed. See [server mocks](server-mocks.md), and the page for your framework under [frameworks](frameworks/README.md).

Servers that aren't Node (Django, Rails, Laravel, Go) need test accounts against a seeded backend: see [other backends](frameworks/other-backends.md).

## Crawling a signed-in app

- Log out links (`/logout`, `/sign-out`, `#/logout`…) are never followed, and with `auth` the login page isn't crawled either.
- Hash routes (`/#/accounts`, Angular `withHashLocation()`) are pages of their own.
- A crawled page that sends renderlint back to the login page (an admin-only route for a non-admin user, for example) is a warning; a page you listed is an error. Turn the rule off with `"rules": { "auth-required": "off" }`.
- If listed pages are reported with "The session from "auth" was not accepted here", the token was set but rejected: an expired JWT, a key the guard doesn't read, or an API call that answered 401. Mock that call, or check the key.

## Coding agents

`renderlint init` installs the `renderlint-setup` skill. It tells agents to handle `auth-required` and `page-not-shown` with option 1: find the key the guard reads and where the role comes from, set test values, and mock the API calls the pages make. No credentials are needed. See [coding agents](agents.md).
