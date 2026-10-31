# Remix / React Router 7 (framework mode)

Covers React Router 7's framework mode and Remix: loaders and actions on the server, cookie session storage, `routes.ts`, flat routes, and `react-router-auto-routes`. Loaders run on the server, so renderlint's [server mocks](../server-mocks.md) answer their requests when renderlint starts the app. For React Router as a library in a Vite SPA, see [React](react.md).

```json
{
  "serve": "npx react-router dev --port 4319 --strictPort",
  "url": "http://localhost:4319",
  "auth": { "login": "/login", "user": "qa@example.com", "password": "${RENDERLINT_PASSWORD}" },
  "roles": {
    "admin":  { "pages": ["/admin"], "mock": { "**/api/auth/login": { "token": "t-admin", "user": { "role": "admin" } }, "**/api/me": { "role": "admin" } } },
    "viewer": { "deny": ["/admin/**"], "mock": { "**/api/auth/login": { "token": "t-viewer", "user": { "role": "viewer" } }, "**/api/me": { "role": "viewer" } } }
  },
  "mock": { "**/api/tasks": "fixtures/tasks.json" }
}
```

- **Production build:** `react-router build`, then `"serve": "PORT=4319 npx react-router-serve ./build/server/index.js"`.
- **A login action that checks the password in your own database** has no HTTP call to mock. Seed a test account per role and give credentials through the environment.
- **Routes** are read from `app/routes.ts` (`route`, `index`, `layout`, `prefix`), `flatRoutes()`, `react-router-auto-routes` folders, and Remix's flat file convention.

Tested on React Router 7 framework mode with cookie session storage and loaders, on `react-router dev` and `react-router-serve`, with no backend. Each role's defects were found, and a viewer sent to `/admin` was reported.
