# React (Vite, React Router)

Covers Vite + React with React Router's data routers (`createBrowserRouter`, `createHashRouter` with loaders) or `<Routes>`, TanStack Router, and Create React App style builds. For Next.js see [Next.js](nextjs.md); for React Router 7's framework mode see [Remix / React Router 7](remix.md).

Everything runs in the browser, so no backend is needed: set what the guard or loader reads, and answer the API with `mock`.

```json
{
  "roles": {
    "admin":  { "storage": { "localStorage": { "rr.token": { "$jwt": { "name": "Ada Admin", "role": "admin" } } } } },
    "viewer": { "storage": { "localStorage": { "rr.token": { "$jwt": { "name": "Vic Viewer", "role": "viewer" } } } }, "deny": ["/admin"] }
  },
  "mock": {
    "**/api/stats": "fixtures/stats.json",
    "**/api/users": "fixtures/users.json",
    "**/api/users/*": "fixtures/user.json"
  }
}
```

- **Where the role comes from:**
  - JWT claims decoded in a loader or context: `{ "$jwt": { … } }`, as above.
  - A user endpoint: one token for all roles and a `/api/me` mock per role.
  - Redux or Zustand persisted to localStorage: the store's JSON.
- **Routes** are read from `createBrowserRouter([...])`, `useRoutes`, `<Routes>` JSX and TanStack Router's route files. Components declared in the router's own file are understood. renderlint also reads the running router's table, from React's internals, so a page reached only by `navigate()` is found too.
- **A second router in the source,** such as a demo `HashRouter` next to the real `createBrowserRouter`, is ignored. The pages aren't checked twice.
- **Dynamic routes** (`/users/:id`) get values from links, the API lists the app received (`/api/users` → ids), or `params`.
- **Production build:** `vite build && renderlint dist`. It serves `dist/` with SPA fallback.
- **Vite plugin:** a live overlay while you develop, and a failing `vite build` on errors. See [integrations](../integrations.md#vite-plugin).

Tested on a React Router 7 data router app (loaders, a JWT role, an admin-only route, "Access denied" in place, `/users/:id`, a button-only page) and a declarative `<HashRouter>` app. Every page was checked as every role, on the dev server and the production build, with no backend. The Playwright integration was tested on a React shop with a real Playwright suite; see [Playwright](../playwright.md).

## Not covered

- Reading the router table at runtime relies on React's internal fiber tree. It is a complement to the source scan, not the only source.
- Nested `<Routes>` inside components are found where they render.
- Lazy routes that fail to load are listed as not checked.
