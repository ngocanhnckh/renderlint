# Server mocks: SSR apps without a backend

In a server-rendered app, the session check and the data fetching run on the server, not in the browser. That covers:
- `middleware.ts`, Auth.js, `getServerSideProps` and server components (Next.js);
- `useFetch` and server routes (Nuxt);
- `hooks.server` and `+page.server` loads (SvelteKit);
- loaders (React Router 7, Remix);
- `HttpClient` with `withFetch()` (Angular SSR).

A browser-side mock can't reach any of them.

When renderlint starts the server itself, from `serve` or the `dev` script it finds, it loads a small preload into the server process. Your `mock` then also answers the requests the **server** makes, through three hooks:
- **global `fetch`:** used by Next.js, Nuxt's ofetch, SvelteKit, React Router and Angular `withFetch()`;
- **undici's global dispatcher:** the `undici` package, and Next.js edge `middleware.ts`;
- **`node:http` / `node:https`:** axios and got.

Nothing else about the app changes, and no backend has to run.

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

## How it works

- **The login form is real.** The app's own auth code runs as usual (Auth.js `authorize`, iron-session, `nuxt-auth-utils`, React Router cookie sessions), and only the API call that checks the password is answered by a mock. Any password works, but write it as `"${RENDERLINT_PASSWORD}"` all the same, so no literal password sits in the config. The app mints the session itself, so no secret is needed.
- **One role per request.** Every request renderlint makes as a role carries a `renderlint-role` cookie. The preload handles each incoming request in its own async context, so every server call made while rendering it gets that role's mocks, even after an `await`, while all roles run at once.
- **Failures name the request.** An SSR page that fails (HTTP 500) because a server request wasn't mocked says which one: `The server's own requests failed: GET http://localhost:4501/api/billing (ECONNREFUSED)`. `report.json` lists every page's server requests under `pages[].server`.
- **Data stress reaches server data.** The reload with longer strings tells the preload (a `renderlint-stress` cookie) to lengthen the JSON the server fetched.
- **The app's own origin is never mocked on the server:** its own routes, and the dev server's internal hops.
- **Next.js's data cache stays clean.** Mocked responses never reach it (`fetch(…, { cache: 'force-cache' })`), so one role can't see another's cached data, and nothing mocked is left in `.next/cache` after the run. Off-the-shelf mocking (MSW, undici `MockAgent`) leaked across roles and into `.next/cache` in our tests, so renderlint uses its own interceptor.

## Tested with

All of these ran with no backend, as admin, viewer, and a viewer sent to an admin page. Each role's planted defects were found, and the denied viewer was reported, not passed.

| Framework | Dev | Production | Auth in the sample app |
|---|---|---|---|
| Next.js 16, App Router (webpack and Turbopack) | yes | `next start` | Auth.js v5, `middleware.ts`, server components |
| Next.js 16, Pages Router | yes | `next start` | iron-session, `getServerSideProps` |
| Nuxt 3.21 | yes | Nitro (`node .output/server/index.mjs`) | `nuxt-auth-utils`, route middleware, `useFetch`, server routes |
| SvelteKit 2 | yes | adapter-node (`node build`) | `hooks.server`, `+page.server` loads |
| React Router 7 framework mode | yes | `react-router-serve` | cookie session storage, loaders |
| Angular 20 SSR | `ng serve` | Express server | `HttpClient` + `withFetch()`, guards, `REQUEST` |

The framework pages list each one's quirks: Angular's allowed hosts, SvelteKit's `ORIGIN`, Nuxt's session password in production.

## A server you start yourself

Run it with the preload, and it reads the mocks renderlint writes to `.renderlint/server-mock.json`:

```bash
NODE_OPTIONS="--require @yitec/renderlint/server-mock" RENDERLINT_SERVER_MOCK=.renderlint/server-mock.json npm run dev
```

Production builds work the same way: `next start`, `node .output/server/index.mjs`, `node build`, `react-router-serve`.

## Safety

- **Off by default.** The preload does nothing unless `RENDERLINT_SERVER_MOCK` is set. renderlint sets it only on the server process it starts.
- **Local requests only.** It only answers requests that come to a loopback host (`localhost`, `127.0.0.1`, `::1`). A request from anywhere else gets the app's real behaviour, with a warning on stderr.
- **Never set it on a deployed server.**
- **To turn it off,** use `"serverMock": false`. `mock` then stays in the browser.

## What it can't do

- **Servers that aren't Node:** Django, Rails, Laravel, Go, PHP. See [other backends](frameworks/other-backends.md).
- **Logins that check the password against the app's own database,** with no HTTP call to mock (Prisma in `authorize`, for example). Use a seeded test account, or `auth.run`.
- **Pages prerendered at `next build`** keep their build-time data. Only dynamic pages use the mocks (cookies, headers, `no-store`).
- **Next.js edge middleware** is reached through undici's global dispatcher, an internal detail of Next.js. Tested on Next 16.
