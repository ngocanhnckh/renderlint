# Next.js

Covers the App Router (server components, `fetch` in server components, `middleware.ts` / `proxy.ts`, Auth.js / NextAuth v5), the Pages Router (`getServerSideProps`, iron-session), static export, and both `next dev` (webpack or Turbopack) and `next start`.

In Next.js the session check and the data fetching run on the server, so a browser-side mock can't reach them. When renderlint starts the app, your `mock` also answers the server's own requests: see [server mocks](../server-mocks.md). The real login form works with no backend. The app's own auth code mints the session; only the API call that checks the password is mocked.

```json
{
  "serve": "npx next dev -p 4319",
  "url": "http://localhost:4319",
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "name": "Ada", "role": "admin" } }, "**/api/me": { "name": "Ada", "role": "admin" } } },
    "viewer": { "deny": ["/admin/**"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "name": "Vic", "role": "viewer" } }, "**/api/me": { "name": "Vic", "role": "viewer" } } }
  },
  "mock": { "**/api/reports": "fixtures/reports.json" }
}
```

- **Auth.js / NextAuth with a Credentials provider:** if `authorize()` calls your API to check the password, mock that call per role, as above. If it queries a database directly (Prisma, Drizzle), there is no request to mock. Use a seeded test account per role, with credentials from the environment.
- **OAuth providers** (Google, GitHub, Entra ID) need a real sign-in. Use a test account with `auth.run` (a Playwright script), or a seeded credentials provider that only exists in development.
- **Production build:** `next build`, then `"serve": "npx next start -p 4319"`. Pages prerendered at build time keep their build-time data; dynamic pages (cookies, headers, `no-store`) use the mocks.
- **Static export** (`output: 'export'`): `next build && renderlint out`.
- **Routes** are read from `app/` and `pages/`: route groups, parallel and intercepting routes, catch-alls, literal `generateStaticParams`, and `.next/prerender-manifest.json` after a build.
- **The data cache is safe.** Mocked responses never reach it, so `force-cache` doesn't leak one role's data to another, and nothing mocked stays in `.next/cache`.
- **Edge middleware** (`middleware.ts`) fetches are mocked too, through undici's global dispatcher.

Tested on Next.js 16:
- the App Router with Auth.js v5, `middleware.ts` and server components, on webpack, Turbopack and `next start`;
- the Pages Router with iron-session and `getServerSideProps`, on dev and `next start`.

All with no backend: each role's defects were found, and a viewer sent to `/admin` was reported (a redirect to `/403`, or "Access denied" at the same URL with HTTP 200).

Route coverage was measured on a 260-URL shop, in [roles and coverage](../roles-and-coverage.md#hundreds-of-pages).

## Not covered

- Mocking edge middleware relies on Next's bundled undici reading the shared global dispatcher, an internal detail. Tested on Next 16.4.
- `next dev` didn't always show edits to server components right away during the hook's change-based re-checks. For CI, prefer `next build && next start`.
