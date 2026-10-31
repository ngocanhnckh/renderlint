# SvelteKit

Covers SvelteKit 2: `hooks.server.ts` sessions, `+page.server.ts` and `+layout.server.ts` loads, form actions for login, `src/routes`. Loads run on the server, so renderlint's [server mocks](../server-mocks.md) answer their requests when renderlint starts the app.

```json
{
  "serve": "npx vite dev --port 4319 --strictPort",
  "url": "http://localhost:4319",
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "role": "admin" } }, "**/api/me": { "role": "admin" } } },
    "viewer": { "deny": ["/admin/**"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "role": "viewer" } }, "**/api/me": { "role": "viewer" } } }
  },
  "mock": { "**/api/tasks": "fixtures/tasks.json" }
}
```

- **Production build** (adapter-node): `vite build`, then `"serve": "ORIGIN=http://localhost:4319 PORT=4319 node build"`. Without `ORIGIN`, SvelteKit rejects the login form's POST as cross-site.
- **A guard answering `error(403)`** is reported as `page-not-shown` for that role, an error if the page is in the role's `pages`.
- **Routes** are read from `src/routes`, including `[param]`, `[[optional]]` and `[...rest]` segments, groups, and literal `entries`.
- **Static sites** (adapter-static): `vite build && renderlint build`.

Tested on SvelteKit 2 with `hooks.server` and `+page.server` loads, on `vite dev` and adapter-node, with no backend. It was also tested with real test accounts against a running backend. Each role's defects were found, and a viewer sent to `/admin` was reported.
