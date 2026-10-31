# Roles and coverage

Two questions decide whether a renderlint run means anything: did it see every page, and did it see each page the way every kind of user sees it? This page covers both.

## Every page as every role

Admin-only pages, a viewer's read-only banner, an upgrade card only free users see: each role renders a different UI. List the roles, and renderlint checks every page as each of them in one run, all roles at once:

```json
{
  "auth": { "storage": { "sessionStorage": { "app.token": "test-token" } } },
  "roles": {
    "admin":  { "mock": { "**/api/me": { "name": "Ada Admin", "role": "admin" } }, "pages": ["/admin"] },
    "viewer": { "mock": { "**/api/me": { "name": "Vic Viewer", "role": "viewer" } }, "deny": ["/admin/**"] }
  },
  "mock": { "**/api/projects": "fixtures/projects.json" }
}
```

A role takes:
- **Sign-in settings:** anything `auth` takes (`storage`, `login`, `user`, `password`, `run`). They go over the top-level `auth`, which holds what every role shares.
  - A role with none of them uses the top-level `auth` as is.
  - `"auth": null` checks the role signed out.
  - `"auth": { … }` on a role replaces the top-level `auth`.
- **`mock`:** its API responses, over the top-level `mock`. They apply in the browser, and on the server for [SSR apps](server-mocks.md).
- **`pages`:** pages the role must see. They are checked as that role, and if the app doesn't show one, that is a `page-not-shown` **error**.
- **`deny`:** paths the role must not see (globs: `/admin`, `/admin/**`). Being turned away from them is recorded as "denied (expected)".

`auth: { roles: { … } }` is accepted too, as an older form.

### Where the role comes from decides what to set

| The app reads the role from | Set |
|---|---|
| A user endpoint (`/api/me`, `/api/session`) | One token for everyone (top-level `auth`), and a `/api/me` mock per role. |
| JWT claims decoded in the frontend (`jwt-decode`, `@auth0/angular-jwt`) | `{ "$jwt": { "sub": "1", "role": "admin" } }` as the storage value. renderlint writes an unsigned token that expires in 2100. It also works inside a persisted store's JSON, as a cookie value, and in a mocked login response. |
| A persisted store (Pinia, Redux, NgRx, Zustand) | The store's JSON: `"localStorage": { "auth": { "token": "t", "user": { "role": "viewer" } } }`. |
| A login form | A shared `"auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" }` plus a mock of the login API per role. Or each role with its own credentials: `"admin": { "user": "${ADMIN_USER}", "password": "${ADMIN_PASSWORD}" }`. |
| A server session (Next.js, Nuxt, SvelteKit, Remix) | The login form, with the password-check API mocked per role. The app's own auth code then mints the session; see [server mocks](server-mocks.md). |

### Pages a role isn't shown are reported, never passed

A page counts as "not shown" if any of these happens:
- a guard redirects it (`/admin` → `/dashboard` or `/403`);
- the server answers HTTP 401 or 403;
- the app renders "Access denied" or "Page not found" in its place.

Such a page is never checked in that role's name.

| Situation | Reported as |
|---|---|
| One role sees the page and another doesn't | `page-not-shown` warning for the other role |
| The page is in that role's `deny` | "denied (expected)", not a finding |
| No role could see a page you listed, or a page in a role's own `pages` | error |
| Redirected to the login page | `auth-required`: the role's session wasn't accepted |

These are not findings:
- the home page forwarding (`/` → `/dashboard`);
- a section opening its default child (`/settings` → `/settings/profile`);
- trailing slashes, case and locale prefixes;
- a redirect every role takes the same way;
- the app's own error pages.

A role's outcome only counts when every viewport agrees, so one slow render can't flip it.

The detection of "Access denied" pages uses English phrases. A guard that renders an empty page in another language isn't recognized: give that role a `deny` entry, or check the role's coverage by hand.

## Every page

### Where renderlint finds pages

1. **The app's routes, read from the source without running it:**
   - Next.js `app/` and `pages/` (route groups, parallel and intercepting routes, catch-alls);
   - Nuxt `pages/`, SvelteKit `src/routes`, Astro `src/pages`;
   - React Router 7 `routes.ts` and flat routes, Remix, TanStack Router;
   - React Router `createBrowserRouter` / `<Routes>`;
   - Angular `Routes` arrays, including lazy `loadChildren`;
   - Vue Router `routes`.

   `npx renderlint routes` lists what it found; `--files` adds the files each route renders.
2. **The route table of the running app's router** (Vue Router, React Router, Angular Router), on dev servers and production builds. This catches routes built at runtime, and pages reached only by a button.
3. **`sitemap.xml`, `robots.txt` and the build output** (`.next/prerender-manifest.json`, prerendered HTML).
4. **Links** on every checked page.

Log-out links are never followed. With `auth`, the sign-in page isn't opened either.

### Values for dynamic routes

`/users/:id`, `/products/[slug]` and `/docs/[...path]` need real values. renderlint takes them from:
- `generateStaticParams`, `getStaticPaths` and `entries`, when they return literals;
- Astro content collections;
- the build manifest and the sitemap;
- links seen while crawling;
- ids and slugs in the JSON lists the app's API returned (`/api/users` → `/users/:id`).

When none of these name a value, the route is listed as `need param values`. Set them:

```json
{ "params": { "/users/:id": ["7", "9"], "/docs/:path+": ["getting-started/install"], "slug": "hello-world" } }
```

A key starting with `/` is a route; any other key is a parameter name that applies to every route using it.

## Hundreds of pages

A shop with 2,000 product pages has one product route. Checking every instance fully takes long and mostly finds the same template defects again. With routes found, `coverage` balances the two:

```json
{ "coverage": { "perRoute": 2, "quick": true } }
```

- **`quick: true` (the default):** every known instance of a route gets a quick check (narrowest viewport, light scheme, no stress, sweep or data stress). Then the `perRoute` instances that look most unlike the first get the full check: longest unbroken word, most text, overflow, broken images, a different layout. Data-specific defects are found that way.
- **`quick: "ends"`:** also adds the widest viewport to the quick check, which catches desktop-only defects.
- **`quick: false`:** checks only the first `perRoute` instances found.
- **`quickMax`:** caps quick checks per run (default 2000).

Measured on a 260-URL Next.js shop with 36 routes and 70 real defects planted on 51 instances:

| Strategy | Time | Defects found |
|---|---|---|
| Check every URL fully | 1025 s | 100% |
| `quick: true` (default) | 527 s | 97% (missed one desktop-only overflow) |
| `quick: "ends"` | 732 s | 100% |
| 2 instances per route, first found, no quick check | 171 s | 26% |

`maxPages` is a hard page limit per role. With routes found, the default is every planned page.

## Reading the coverage report

Every run prints a coverage line and writes `.renderlint/coverage.json`:

```
◐ Coverage 270 URL(s), 36 route(s): 34 checked, 1 need a role, 1 not checked (94.4% of routes)
```

| Status | Meaning | What to do |
|---|---|---|
| `checked` | At least one instance got the full check. | — |
| `need sign-in` | Sent to the sign-in page, or HTTP 401. | Set up `auth` ([authentication](authentication.md)). |
| `need a role` | Redirected by a guard, HTTP 403, or an access-denied page. | Add a role that may see it, or `deny` it for the roles that may not. |
| `need param values` | A dynamic route with no known value. | Set `params`. |
| `redirect elsewhere` | Always lands on another page. | Usually fine (`/` → `/dashboard`). If not, it's a guard: see `need a role`. |
| `not reachable` / `failed to load` | The page errored. The reason names the request. | Fix the mock or the server. |
| `not checked` | The reason says why: a catch-all (not-found) route, `exclude`, a log-out route, the sign-in page while signed in, a URL that looks destructive (`/delete`, `/cancel`…), or the page limit. | List the URL in `pages` if it should be checked; raise `maxPages`. |
| `excluded` | `coverage.ignore` matched. | — |

### Fail CI when coverage drops

```json
{ "coverage": { "min": 100, "ignore": ["/internal/*"], "baseline": ".renderlint-baseline/coverage.json" } }
```

- **`min`:** fails when fewer than this percentage of routes were checked (CLI `--min-coverage 100`).
- **`ignore`:** route patterns you leave out on purpose. They don't count.
- **`baseline`:** fails when a route checked in an earlier `coverage.json` is no longer checked (CLI `--coverage-baseline <file>`). Commit a copy of a good run's `coverage.json` to use it.

## Re-checking only what an edit touched

Every run also writes `.renderlint/page-map.json`: for each route, the source files and API endpoints it renders. The Claude Code Stop hook (`renderlint hook`) uses it to re-check only the routes an edit affects. An edit to global CSS, the layout or a shared module re-checks every route. On a 46-route Next.js app:

| Edit | Pages checked | Time |
|---|---|---|
| One component | 3–9 | 6–17 s |
| Global CSS | 46 | 79 s |
| Full run | 46 | 167 s |

Across 30 typical edits, the hook missed no page whose rendering changed. Routes that still had errors in the last run are always re-checked, so the agent sees whether its fix worked.
