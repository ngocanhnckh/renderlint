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

## Server-rendered apps (Next.js, Nuxt, SvelteKit, React Router / Remix)

In an SSR app the session check and the data fetching run on the server: `middleware.ts`, Auth.js, `getServerSideProps`, server components, Nuxt `useFetch` and server routes, SvelteKit `hooks.server` and `+page.server` loads, React Router loaders. A browser-side `mock` never reaches them. When renderlint starts the app (`serve`, or the `dev` script it finds on its own), it loads a small preload into the server process (`NODE_OPTIONS=--require renderlint/server-mock`), and `mock` then also answers the requests the **server** makes: `fetch` (which Next.js, ofetch/Nuxt, SvelteKit and React Router all use) and `node:http`/`https` (axios, got). Nothing else about the app changes, and no backend has to run.

So the real login form works without a backend: the app's own auth code (Auth.js `authorize`, an iron-session, `nuxt-auth-utils` or React Router cookie session, a token cookie) runs as usual, and the API call that checks the password is answered by a mock. Sessions are minted by the app itself, so no secret is needed.

### Every role

`roles` checks the app once per role. Each role gets its own session, its own mocks (over the top-level ones) and, optionally, pages only it can see:

```json
{
  "serve": "npm run dev",
  "pages": ["/dashboard"],
  "auth": { "login": "/login", "user": "qa@example.com", "password": "any" },
  "mock": { "**/api/reports": "fixtures/reports.json" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "name": "Ada", "role": "admin" } }, "**/api/me": { "name": "Ada", "role": "admin" } } },
    "viewer": { "pages": ["/tasks"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "name": "Vic", "role": "viewer" } }, "**/api/me": { "name": "Vic", "role": "viewer" } } }
  }
}
```

- Pages are reported as `/admin [role: admin]`. Each role crawls the links it sees (an admin's nav has the admin pages).
- A role's `auth` replaces the top-level one (`"auth": null` checks signed out). Real test accounts work too: `"admin": { "auth": { "login": "/login", "user": "${ADMIN_USER}", "password": "${ADMIN_PASSWORD}" } }`.
- The server knows which role a request is for from a `renderlint-role` cookie renderlint sends with every request of that role: the preload handles each incoming request in its own async context, so every server call made while rendering it (after any `await`) gets that role's mocks.
- A page listed in a role's `pages` that the app doesn't show it is reported as `auth-required` (error): sent somewhere else (`/admin` → `/403` or `/dashboard`), answered 401/403, or showing only an "Access denied" heading. The role's session or mocks are wrong, and the denial page isn't checked in the page's name.
- An SSR page that fails (HTTP 500) because a server request isn't mocked says which one: `The server's own requests failed: GET http://localhost:4501/api/billing (ECONNREFUSED)`. `report.json` lists every page's server requests (`pages[].server`).
- Data stress reaches server-rendered data: the reload with longer strings tells the preload (a `renderlint-stress` cookie) to lengthen the JSON the server fetched.
- Next.js: mocked responses never reach Next's data cache (`fetch(…, { cache: 'force-cache' })`), so one role can't get another's cached data, and nothing mocked is left in `.next/cache` after the run. Pages prerendered at `next build` keep their build-time data; dynamic pages (cookies, headers, `no-store`) use the mocks.
- A server you start yourself: run it with the preload, and it reads the mocks renderlint writes to `.renderlint/server-mock.json`:
  `NODE_OPTIONS="--require renderlint/server-mock" RENDERLINT_SERVER_MOCK=.renderlint/server-mock.json npm run dev`.
  Production builds work the same way (`next start`, `node .output/server/index.mjs`, `node build`, `react-router-serve`).
- `"serverMock": false` keeps `mock` browser-only. The app's own origin is never mocked on the server (its own routes, the dev server's internal hops).
- Not covered: servers that aren't Node (Django, Rails, Laravel, Go), and logins that check the password in the app's own database (no HTTP call to mock). For those, use test accounts against a seeded backend, or `auth.run`.

## Crawling a signed-in app

- Log out links (`/logout`, `/sign-out`, `#/logout`…) are never followed, and with `auth` the login page isn't crawled either.
- Hash routes (`/#/accounts`, Angular `withHashLocation()`) are pages of their own.
- A crawled page that sends renderlint back to the login page (an admin-only route for a non-admin user, for example) is a warning; a page you listed is an error. Turn the rule off with `"rules": { "auth-required": "off" }`.
- If listed pages are reported with "The session from "auth" was not accepted here", the token was set but rejected: an expired JWT, a key the guard doesn't read, or an API call that answered 401. Mock that call, or check the key.

## Coding agents

Agents set up by `renderlint init` are told to handle `auth-required` with option 1: find the key the guard reads, set a test value, and mock the API calls the pages make. No credentials are needed.
