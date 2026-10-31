# Django, Rails, Laravel, Go and other server-rendered backends

When a non-Node server renders the HTML from its own database, the session, the role checks and the data all live on that server. renderlint can't answer those requests from outside, so the reliable way to check every page as every role is **test accounts against a seeded local or staging database**.

```json
{
  "serve": "bin/rails server -p 4319",
  "url": "http://localhost:4319",
  "roles": {
    "admin":  { "login": "/users/sign_in", "user": "${ADMIN_USER}", "password": "${ADMIN_PASSWORD}", "pages": ["/admin"] },
    "editor": { "login": "/users/sign_in", "user": "${EDITOR_USER}", "password": "${EDITOR_PASSWORD}", "deny": ["/admin/**"] },
    "member": { "login": "/users/sign_in", "user": "${MEMBER_USER}", "password": "${MEMBER_PASSWORD}", "deny": ["/admin/**", "/editor/**"] }
  }
}
```

| Backend | `serve` | Login page |
|---|---|---|
| Django | `python manage.py runserver 4319` | `/accounts/login/` (or your `LOGIN_URL`) |
| Rails (Devise) | `bin/rails server -p 4319` | `/users/sign_in` |
| Laravel (Breeze, Jetstream, Fortify) | `php artisan serve --port=4319` | `/login` |
| Go, Phoenix, ASP.NET, anything else | your server command | your login path |

- **Seed the data the pages need,** including worst cases: long names, unbroken emails, empty lists. Use your framework's fixtures or seeds (`manage.py loaddata`, `rails db:seed`, `php artisan db:seed`) in CI before running renderlint.
- **Login forms with a CSRF token** work: renderlint fills in and submits the real form in the browser, so the token is sent like a user's. For unusual fields, set the selectors: `"login": { "page": "/login", "fill": { "#email": "${ADMIN_USER}", "#password": "${ADMIN_PASSWORD}" }, "submit": "button[type=submit]" }`.
- **Single sign-on, two-factor:** write the steps as a Playwright script in `auth.run` (JS config), using a test identity.
- **Pages:**
  - Routes can't be read from Python, Ruby, PHP or Go source.
  - renderlint follows links and reads `sitemap.xml`, and infers route patterns from the URLs it sees (`/projects/:id`).
  - List pages no link reaches in `pages`, or add a sitemap.
- **Destructive links** (`/delete`, `?action=cancel`) are never opened by the crawl. That matters here: these sessions are real. See [security](../security.md).

## If the frontend is a separate SPA

If your backend is only an API and the UI is a React, Vue or Angular app, you don't need the backend at all. Check the SPA frontend-only with `mock`, as on the [Angular](angular.md), [React](react.md) or [Vue](vue.md) pages.

## Not covered

The server mocks are Node only, so pages these backends render can't be checked without the backend running. Server-side login through a real form, the role detection (redirects, 401/403, "Access denied"), crawling and the coverage report work the same as for any other app. They were tested on WordPress (PHP): see [WordPress](../wordpress.md).
