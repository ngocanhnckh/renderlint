---
name: renderlint-setup
description: Set up renderlint so it checks every page of this app, including pages behind a login, admin-only pages and dynamic routes, without a backend. Use when adding renderlint to a project, when its report shows auth-required, page-not-shown or routes that were not checked, or when the coverage table has gaps.
---

# Make renderlint check every page

renderlint renders the app in a browser and reports visual defects. It can only report defects on the pages it actually sees. Your job here is to make it see every route, as every role, with realistic data. The goal is that `npx renderlint` ends with a coverage line where every route is "checked" or deliberately excluded.

Work in this order and run `npx renderlint` after each step. Read the report's **Coverage** line and the **Pages by role** table each time. `.renderlint/coverage.json` has every route with its status and the reason.

## 1. Find out what kind of app this is

- **Framework:** check `package.json`. `npx renderlint routes` lists the routes found in the source, so you can see what renderlint already knows.
- **Rendering mode:**
  - **SPA** (Vite + React/Vue/Angular, `ng serve`, `ng build`): auth checks and data fetching run in the browser.
  - **SSR** (Next.js, Nuxt, SvelteKit, React Router 7 / Remix framework mode, Angular SSR): they run on the Node server.
  - **Non-Node backend** (Django, Rails, Laravel, Go, PHP): the server renders HTML from its own database.
- **How to start it:** renderlint starts the `dev` script on its own. Set `"serve"` and `"url"` in `renderlint.config.json` only if that doesn't work.

## 2. Find how the app decides who is signed in, and as what

Read the code; don't guess. Look for:

- **Route guards:**
  - Angular: `canActivate` / `canMatch` functions.
  - Vue: `router.beforeEach`.
  - React Router: `loader` functions that `redirect`.
  - Next.js: `middleware.ts`.
  - SvelteKit: `hooks.server.ts`.
  - Nuxt: `defineNuxtRouteMiddleware`.
- **Where the token or session lives:**
  - `sessionStorage.setItem` / `localStorage.setItem` in the auth service;
  - a persisted store (Pinia, Redux, NgRx, Zustand);
  - a cookie;
  - a server session (Auth.js, iron-session, `nuxt-auth-utils`, cookie session storage).
- **Where the role comes from:**
  - a user endpoint (`/api/me`, `/api/user`, `/auth/session`);
  - claims decoded from a JWT in the frontend (`jwt-decode`, `atob(token.split('.')[1])`);
  - a field in the persisted store;
  - the server session.
- **Which roles exist,** and which routes each role may see (guards with `roles: [...]`, `requiresAdmin`, `if (user.role !== 'admin')`).

## 3. Give renderlint a session per role, frontend only

Prefer settings that need **no backend and no real credentials**. A route guard can't tell a test token from a real one, and the API calls can be answered with fixtures. This works the same on a laptop and in CI.

```json
{
  "auth": { "storage": { "sessionStorage": { "<key the guard reads>": "test-token" } } },
  "roles": {
    "admin":  { "mock": { "**/api/me": { "name": "Ada Admin", "role": "admin" } } },
    "viewer": { "mock": { "**/api/me": { "name": "Vic Viewer", "role": "viewer" } }, "deny": ["/admin/**"] }
  },
  "mock": { "**/api/projects": "fixtures/projects.json" }
}
```

How to set the role depends on where it comes from:

| Role comes from | What to set |
|---|---|
| A user endpoint | The same token for every role (top-level `auth`) and a different `/api/me` mock per role. |
| JWT claims decoded in the frontend | `{ "$jwt": { "sub": "1", "role": "admin" } }` as the storage value. renderlint writes an unsigned token that expires in 2100. |
| A persisted store | The store's JSON as the value: `"localStorage": { "auth": { "token": "t", "user": { "role": "viewer" } } }`. |
| A login form | Top-level `"auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" }` plus a per-role mock of the login API (`"**/api/auth/login": { "token": "t-admin", "user": { "role": "admin" } }`). |
| An SSR server session | Same as a login form. renderlint starts the server with a preload, so `mock` also answers the server's own requests and the app's real auth code mints the session. No secret is needed. |

Each role: anything `auth` takes (`storage`, `login`, `user`, `password`) plus:
- `mock`: its own API responses, layered over the top-level `mock`.
- `pages`: routes it must see. Not being shown one is an error.
- `deny`: routes it must not see, so being turned away is recorded as expected.

Roles run at the same time.

**Non-Node backends** can't be mocked from outside. Use test accounts against a seeded local or staging database: `"admin": { "login": "/login", "user": "${ADMIN_USER}", "password": "${ADMIN_PASSWORD}" }`.

## 4. Serve the data the pages need, with worst cases in it

- **Find every API call:**
  - `fetch(`, `axios`, `HttpClient`, `useFetch`, `$fetch`, `loader`/`load` functions, server components;
  - or open the page and look at `.renderlint/report.json` (`pages[].server` lists the server's own requests on SSR apps).
- **Answer each one with `mock`:** a JSON file path, inline data, or `{ "status": 500, "json": {…} }`. Use `"**/api/users*"` patterns. On an SSR page, an unmocked server request is reported with the exact URL that failed. Mock that one.
- **Reuse what exists:** if the project already has MSW handlers (`src/mocks/handlers.ts`) or a HAR recording, use `"mockFrom": ["src/mocks/handlers.ts"]` instead of writing fixtures.
- **Put worst cases in the fixtures.** This is where real bugs hide:
  - the longest realistic name (`"Aleksandra Wiśniewska-Kowalczyk"`);
  - a 60-character email with no spaces;
  - a 9-digit amount;
  - an empty list;
  - a `null` optional field;
  - a long unbroken URL.

  renderlint also lengthens every JSON response once on its own (`stressData`).
- **Empty and error states** are pages too. Add them as `states`: `{ "name": "no projects", "page": "/projects", "mock": { "**/api/projects": [] } }`.

## 5. Fill in dynamic routes

`/users/:id`, `/products/[slug]` need real values. renderlint takes them from links, the build manifest, `generateStaticParams`, the sitemap and ids in API lists. If the report says `need param values`, set them:

```json
{ "params": { "/users/:id": ["7"], "/products/:slug": ["very-long-product-name-with-many-words", "x"] } }
```

Pick values whose data is the worst case. Every value you list must exist in the mocks.

## 6. Read the coverage and close every gap

Run `npx renderlint` and read the **Coverage** line, the **Pages by role** table and `.renderlint/coverage.json`:

| Status / reason | What to do |
|---|---|
| `need sign-in` / `auth-required` | The session wasn't accepted. Check the storage key and the token shape, or mock the call that answered 401. |
| `need a role` / `page-not-shown` | Not this role's page: add it to that role's `deny`. Meant to be visible: give the role what the guard checks. |
| `need param values` | Add `params` (step 5). |
| `redirect elsewhere` | Usually fine (`/` → `/dashboard`). If it's a real page, the guard turned renderlint away: see the two rows above. |
| `not reachable` / `failed to load` | Fix the mock or the server. The reason names the request. |
| catch-all, log-out, sign-in page | Expected. Check the sign-in page in a separate run without `auth`, if it matters. |
| `looks like it changes data` | Pages with delete, cancel or reset in the URL are never opened by the crawl. List one in `pages` only if it just shows a form. |
| `page limit (maxPages) reached` | Raise `maxPages` or set `"coverage": { "perRoute": 1 }`. |

Iterate until every route is `checked`, or excluded with a reason you can state: `"coverage": { "ignore": ["/internal/*"] }` or a role's `deny`. Then lock it in with `"coverage": { "min": 100 }` so a later change can't silently lose pages.

## Rules you must follow

- **Credentials:**
  - Only through environment variables (`"${RENDERLINT_PASSWORD}"`), never written in the config. renderlint warns when it finds one.
  - Use test accounts, never production admin accounts, and a local or staging backend, never production.
- **Never use the app's real secrets** (`AUTH_SECRET`, signing keys) to forge sessions. Frontend tokens from `$jwt` are unsigned on purpose: only the frontend accepts them, a real backend rejects them.
- **Don't change application code to make renderlint pass the guards,** for example a test bypass in the auth service. Everything goes in `renderlint.config.json` and fixtures.
- **Don't turn rules off to make a coverage gap go away.** `auth-required` and `page-not-shown` mean a page was never checked.
- **Add `.renderlint/` to `.gitignore`** (`renderlint init` does this). Commit `renderlint.config.json` and the fixtures.

Details: [docs/roles-and-coverage.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/roles-and-coverage.md), [docs/authentication.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/authentication.md), [docs/server-mocks.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/server-mocks.md), and the page for your framework under [docs/frameworks/](https://gitlab.com/anhnn.a05/renderlint/-/tree/master/docs/frameworks).
