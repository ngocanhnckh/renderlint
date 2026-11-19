---
title: How to test every route and role behind a login
description: Automated UI checks usually see only the login form. Here is how to check every route as every role, with no backend, and fail CI when a page goes unchecked.
slug: test-every-route-and-role-behind-login
date: 2026-11-16
tags: testing, authentication, roles, ci
rule: auth-required, page-not-shown
---

Most of an app sits behind a login, and a crawler without a session sees one page: the login form. To test every route and role, give the tool the session your route guard accepts, mock the API the pages call, list your roles, and read a coverage report that gives each route a status. A check that quietly tests `/login` in place of `/dashboard` passes while the real page is never looked at.

- A redirect to `/login` is a missing page, not a passed page.
- Routes should come from your source and your router, not only from links.
- Roles need their own session, their own mock data and their own expected "no".
- Coverage must be a number you can fail a build on.

## Why do crawlers miss the pages behind a login?

A crawler loads a URL, collects the links, and loads those. That model breaks in four ways on a real app.

**The SPA sends everything to `/login`.** An Angular, React or Vue app with a route guard redirects every inner route to the sign-in page when there is no session. The crawler loads `/dashboard`, lands on `/login`, finds the login form, checks it, and reports no problems. The report is green and the dashboard was never opened.

**Some routes have no link.** A page reached only by a button, a row click or a router call has no `<a href>` to follow. It exists in the router and nowhere in the HTML.

**Dynamic routes need values.** `/users/:id` and `/products/[slug]` are patterns. Nothing in them says which id to load.

**Roles see different pages.** An admin sees `/admin/users`. A viewer is turned away. An upgrade card appears only for free users. One session can't show you all of that.

## How should a UI check treat a redirect to the login page?

As a failure of coverage, never as a pass. renderlint reports a page that lands on a login page, or on an identity provider such as Entra ID, Auth0, Okta or Keycloak, as `auth-required` instead of checking it. The login page itself is still checked, under its own name.

This is the report from running renderlint on a small SPA fixture with a route guard and no session (the `test/fixtures/auth` folder in the renderlint repository). The second finding, for `/hash.html`, is left out here:

```text
✖ auth-required (2)  A page renderlint was asked to check sent it to a login page or identity provider instead, so the page itself was never checked. …
  error /index.html was not checked: the app sent renderlint to /login instead. Pages behind a login need "auth" in renderlint.config (log in once, or set the token your route guard reads and mock the API: no backend needed).
        page /index.html · all viewports
  …
```

The finding is an error for a page you listed, and a warning for a page found by crawling (an admin-only route for a non-admin user, for example). You can turn the rule off with `"rules": { "auth-required": "off" }`, but the default makes a gap visible.

## How do you get a session without a backend?

A route guard usually checks only that a token exists. It can't tell a test value from a real one. So set the token the guard reads and serve the API calls the pages make with `mock`:

```json
{
  "pages": ["/dashboard", "/accounts"],
  "auth": { "storage": { "sessionStorage": { "acme.token": "test-token" } } },
  "mock": { "**/api/me": { "name": "Dana" }, "**/api/accounts": "fixtures/accounts.json" }
}
```

With this, the inner pages render with nothing but the dev server running. No credentials are involved, the data is the same on every run, and it works the same in CI.

| Where the app keeps its session | What to set |
|---|---|
| `sessionStorage` or `localStorage` key | `"auth": { "storage": { "sessionStorage": { "key": "test-token" } } }` |
| A persisted store (Pinia, Redux, NgRx, Zustand) | The store's JSON as an object: `"localStorage": { "auth": { "token": "t", "user": { "id": 1 } } }` |
| A cookie the frontend only checks for | `"storage": { "cookies": [{ "name": "session", "value": "test" }] }` |
| A JWT decoded in the frontend | `{ "$jwt": { "sub": "1", "role": "admin" } }`: renderlint writes an unsigned token that expires in 2100 |
| `HttpOnly` cookie checked by the server | The real login form, or a backend |

To find the key, search the auth service for `sessionStorage.setItem` or `localStorage.setItem`, or sign in once and look under Application > Storage in DevTools. The mocked endpoints are the Fetch/XHR calls in the network tab. Put worst cases in the fixtures, such as a 60-character email.

### Can it log in through the real form?

Yes. renderlint fills the form once and reuses the session (cookies, localStorage, sessionStorage and IndexedDB) for every page and width:

```json
{
  "auth": { "login": "/login", "user": "${RENDERLINT_USER}", "password": "${RENDERLINT_PASSWORD}" }
}
```

```bash
RENDERLINT_USER=qa@example.com RENDERLINT_PASSWORD=… npx renderlint
```

Keep credentials in environment variables or CI secrets and use a test account. For SSO, MFA or magic links, a JavaScript config takes `auth.run`, which receives a Playwright page and can do anything a test can. If a login fails, the run stops with what the form said and saves `.renderlint/screens/login-failed.png`.

## How do you find routes that have no links?

Read them from the source, then from the running router. renderlint reads routes from Next.js (`app/` and `pages/`), Nuxt, SvelteKit, Astro, React Router 7 and Remix, TanStack Router, Angular `Routes` arrays (including lazy `loadChildren`), Vue Router and React Router configs, all without running the app. It also reads the route table of the running router (Vue Router, React Router, Angular Router), which catches routes built at runtime and pages reached only by a button. `sitemap.xml`, `robots.txt` and build output add more.

`npx renderlint routes` lists what it found, and `--files` adds the files each route renders.

For dynamic routes, values come from `generateStaticParams`, `getStaticPaths` and `entries` when they return literals, from the build manifest and sitemap, from links it crawls, and from ids in the JSON lists your API returns (`/api/users` fills `/users/:id`). When nothing names a value, set it:

```json
{ "params": { "/users/:id": ["7", "9"], "/docs/:path+": ["getting-started/install"], "slug": "hello-world" } }
```

## How do you test every role at once?

List the roles. renderlint checks every page as each of them in one run:

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

A role can take its own sign-in settings, its own `mock`, `pages` it must see, and `deny` paths it must not. Pages show up as `/admin [role: admin]`, and the report has a route by role table.

### What is the difference between page-not-shown and auth-required?

`auth-required` means the session wasn't accepted and the app sent the visitor to sign in. `page-not-shown` means the visitor was signed in but not shown the page. It fires when a guard redirects (`/admin` to `/403`), the server answers HTTP 401 or 403, or the app renders "Access denied" or "Page not found" in place of the page.

| Situation | Reported as |
|---|---|
| One role sees the page and another doesn't | `page-not-shown` warning for the other role |
| The page is in that role's `deny` | "denied (expected)", not a finding |
| No role could see a page you listed, or a page in a role's own `pages` | error |
| Redirected to the login page | `auth-required`: the role's session wasn't accepted |

A page that is not shown is never checked in that role's name. Home page forwarding (`/` to `/dashboard`), a section opening its default child, trailing slashes and locale prefixes are not findings. The "Access denied" detection uses English phrases, so for a guard that renders an empty page in another language, add a `deny` entry.

## What about server-rendered apps?

In Next.js, Nuxt, SvelteKit, React Router or Remix, and Angular SSR, the session check and data fetching run on the server. A browser-side mock can't reach `middleware.ts`, `getServerSideProps` or loaders. When renderlint starts the server itself, a small preload makes `mock` answer the server's own requests too (global `fetch`, undici, and `node:http`/`node:https`). The real login form runs, the app mints its own session, and only the API call that checks the password is mocked.

The preload does nothing unless `RENDERLINT_SERVER_MOCK` is set, and it only answers requests to a loopback host. It can't help servers that aren't Node (Django, Rails, Laravel, Go), or logins that check a password against the app's own database with no HTTP call to mock. Those need a seeded backend with test accounts. See the [server mocks docs](https://github.com/ngocanhnckh/renderlint/blob/master/docs/server-mocks.md).

## How do you know every route was checked?

Every run prints a coverage line and writes `.renderlint/coverage.json`. A report on a larger app looks like this (the example is from renderlint's documentation):

```text
◐ Coverage 412 URL(s), 38 route(s): 35 checked, 2 need a role, 1 need param values
  needs a role /admin/users  app/admin/users/page.tsx — the page says "Access denied"
  needs param values /reports/:id  app/reports/[id]/page.tsx — no value for :id (…set "params")
```

| Status | Meaning | What to do |
|---|---|---|
| `checked` | At least one instance got the full check | Nothing |
| `need sign-in` | Sent to the sign-in page, or HTTP 401 | Set up `auth` |
| `need a role` | A guard redirect, HTTP 403 or an access-denied page | Add a role that may see it, or `deny` it |
| `need param values` | A dynamic route with no known value | Set `params` |
| `redirect elsewhere` | Always lands on another page | Usually fine |
| `not checked` | A catch-all route, `exclude`, a log-out route, a URL that looks destructive, or the page limit | List it in `pages`, or raise `maxPages` |

Then make it a gate. `--min-coverage 100` (or `coverage.min`) fails when routes go unchecked, and `--coverage-baseline <file>` fails when a route that was checked in an earlier run no longer is:

```json
{ "coverage": { "min": 100, "ignore": ["/internal/*"], "baseline": ".renderlint-baseline/coverage.json" } }
```

### Does checking hundreds of URLs take hours?

A shop with 2,000 product pages has one product route. renderlint gives every instance of a route a quick check (narrowest viewport, light scheme, no stress or sweep), then gives the instances that look most unlike the first the full check. This is the measurement from the docs, on a 260-URL Next.js shop with 36 routes and 70 real defects planted on 51 instances:

| Strategy | Time | Defects found |
|---|---|---|
| Check every URL fully | 1025 s | 100% |
| `quick: true` (default) | 527 s | 97% (missed one desktop-only overflow) |
| `quick: "ends"` | 732 s | 100% |
| 2 instances per route, first found, no quick check | 171 s | 26% |

The last row is why the default isn't "check the first two". Without the quick pass, about three quarters of the planted defects were missed.

## What this looks like with a coding agent

`renderlint init` installs a `renderlint-setup` skill that tells an agent to handle `auth-required` and `page-not-shown` the same way: find the key the guard reads and where the role comes from, set test values, mock the API calls. No credentials are needed. The suggested setup prompt tells the agent to use the skill until the coverage report shows every route checked. More in [catch UI bugs written by AI coding agents](/blog/catch-ui-bugs-ai-coding-agents/).

## How renderlint catches it

`auth-required` and `page-not-shown` are not visual rules. They protect the other rules from a false green. After each navigation renderlint looks at where the page ended up (login page, identity provider, 401 or 403, a redirect, an "Access denied" body) and records the outcome per viewport. A role's outcome counts only when every viewport agrees, so one slow render can't flip it. Neither finding is ever counted as a pass, and the coverage report names each unchecked route and why. See the [rules reference](/rules/#auth-required) and the [roles and coverage docs](https://github.com/ngocanhnckh/renderlint/blob/master/docs/roles-and-coverage.md).

Limits: the "Access denied" detection uses English phrases. Server mocks are Node only, and pages prerendered at `next build` keep their build-time data. A page behind a click (a dialog, a wizard step) is linted only if you list it in `states` or reach it in a Playwright test. Credentials are never sent anywhere, and log-out and destructive links (delete, cancel, unsubscribe) are never opened.

## Frequently asked questions

### Do I need real credentials?

No, for the frontend-only setup. You set a token the guard accepts and mock the API. If you use the real login form, use a test account and keep the password in an environment variable.

### Will renderlint click "Sign out" or "Delete"?

No. Log-out links and destructive links are never followed, and with `--ux` the requests that change data are answered by renderlint and never reach your server.
