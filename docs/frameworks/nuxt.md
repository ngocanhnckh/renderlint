# Nuxt

Covers Nuxt 3: `pages/`, route middleware (`defineNuxtRouteMiddleware`), `useFetch` / `$fetch` during SSR, server routes, and `nuxt-auth-utils` sessions. Nuxt fetches on the server during SSR, so renderlint's [server mocks](../server-mocks.md) answer those requests when renderlint starts the app.

```json
{
  "serve": "npx nuxt dev --port 4319",
  "url": "http://localhost:4319",
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "role": "admin" } }, "**/api/me": { "role": "admin" } } },
    "viewer": { "deny": ["/admin/**"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "role": "viewer" } }, "**/api/me": { "role": "viewer" } } }
  },
  "mock": { "**/api/tasks": "fixtures/tasks.json" }
}
```

- **The app's own server routes** (`server/api/*`) are never mocked: they're the app. What they fetch from an external API is.
- **Production build:** `nuxt build`, then `"serve": "NUXT_SESSION_PASSWORD=$NUXT_SESSION_PASSWORD PORT=4319 node .output/server/index.mjs"`. The production server doesn't read `.env`, so pass the session password through the environment. Use a throwaway password for tests, not the production one.
- **Static generation:** `nuxt generate && renderlint .output/public`.
- **Routes** are read from `pages/`: nested routes, optional and catch-all params, groups, and `definePageMeta` paths.
- **Node 20.19 or later** is needed by Nuxt 3.21.

Tested on Nuxt 3.21 with `nuxt-auth-utils`, route middleware, `useFetch` and server routes, on `nuxt dev` and the Nitro production server, with no backend. Each role's defects were found, and a viewer sent to `/admin` was reported.
