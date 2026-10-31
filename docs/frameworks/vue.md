# Vue

Covers Vue 3 with vue-router (`router.beforeEach` guards, `meta.roles`, history and hash modes) and Pinia, including persisted stores. For Nuxt see [Nuxt](nuxt.md).

Everything runs in the browser, so no backend is needed:

```json
{
  "roles": {
    "admin":  { "storage": { "localStorage": { "auth": { "token": "t", "user": { "name": "Ada Admin", "role": "admin" } } } } },
    "viewer": { "storage": { "localStorage": { "auth": { "token": "t", "user": { "name": "Vic Viewer", "role": "viewer" } } } }, "deny": ["/admin"] }
  },
  "mock": { "**/api/users": "fixtures/users.json", "**/api/users/*": "fixtures/user.json" }
}
```

- **Pinia with `pinia-plugin-persistedstate`** stores the whole store as JSON under the store's id. Write that JSON as the value, as above. Look in DevTools > Application > Local Storage after signing in once to see its shape.
- **A role from `/api/me` or a JWT:** see [roles and coverage](../roles-and-coverage.md#where-the-role-comes-from-decides-what-to-set).
- **Routes** are read from the `routes` arrays passed to `createRouter` (spreads and imported arrays too). They are also read from the running router with `getRoutes()`, in dev and production builds. With `createWebHashHistory()`, every route is checked as a hash route (`/#/users`).
- **Production build:** `vite build && renderlint dist`.

Tested on a Vue 3 + vue-router + Pinia app (persisted store, `beforeEach` guard, hash routing, an admin-only route, "Access denied" in place, `/users/:id`, a button-only page). Every page was checked as every role, on the dev server and the production build, with no backend.
