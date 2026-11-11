# Security

renderlint is a test tool. It renders your app in a headless browser and measures what it sees. To check signed-in pages it needs a session, and for SSR apps it runs code inside the server it starts. This page says exactly what it does and doesn't do, so you can run it with confidence.

## What renderlint never does

- **Writes into your build output or your source.** Nothing is injected into `dist/`, `.next/`, `.output/` or any build. The SSR mock goes into the server process only through `NODE_OPTIONS`, and only on the server renderlint itself starts. `renderlint init` changes only what it prints: `package.json` scripts, `renderlint.config.json`, `AGENTS.md`/`CLAUDE.md`, `.claude/`, `.gitignore`.
- **Follows links that look like they change data.** A link whose path segment, query key or query value is one of these words is never opened by the crawl, from links, the source's routes or the router's table:

  > delete, remove, destroy, cancel, unsubscribe, deactivate, reset, revoke, purge, wipe, terminate, erase

  `/orders/3/cancel`, `?action=delete` and `/account/deactivate` are skipped and listed in the coverage report. A word inside a slug (`/blog/how-to-remove-stains`) is not. A page you list yourself in `pages` is opened. Do that only for pages that just show a form.
- **Follows log-out links.** They would end the session every other page is checked with.
- **Submits forms,** other than the login form you configure in `auth.login`. It reads pages; it doesn't click "Save".
- **Uses your app's secrets.** It never reads `AUTH_SECRET`, `NEXTAUTH_SECRET`, session passwords or signing keys, and never forges a signed session.
  - Tokens from `{ "$jwt": … }` are **unsigned** on purpose: a frontend that only decodes the token accepts them, and any real backend rejects them.
  - For SSR apps, the app's own auth code mints the session after a mocked password check.
- **Sends data anywhere.** Everything stays on your machine, in `.renderlint/`. There is no telemetry.

## Server mocks are local only

The SSR preload (`@yitec/renderlint/server-mock`) does nothing unless `RENDERLINT_SERVER_MOCK` is set. renderlint sets it only on the server process it starts.

Even then, the preload only answers requests that come to a loopback host: `localhost`, `127.0.0.1` or `::1`. A request from any other host gets the app's real behaviour, and a warning on stderr. So a misconfigured deployment can't serve mocked data or mocked logins to real users. Still: never set `RENDERLINT_SERVER_MOCK` or the preload on a deployed server. `"serverMock": false` turns the server side off entirely.

## Credentials

- **Prefer frontend-only sessions.** A test token plus `mock` needs no credentials at all ([roles and coverage](roles-and-coverage.md)).
- **When a real login is needed, use environment variables.** Write `"password": "${RENDERLINT_PASSWORD}"` and set the variable locally or as a CI secret. renderlint warns when a password, secret or real-looking token is written out in a config file:

  ```
  renderlint: roles.admin.password is written out in renderlint.config.json. Keep it out of the repository: write "${SOME_ENV_VAR}" and set the variable where renderlint runs.
  ```

  Placeholder tokens (`"test"`) and `{ "$jwt": … }` don't trigger the warning, and neither do values a JS config reads from `process.env`.
- **Use test accounts,** one per role, with only the permissions that role needs. Never a production administrator.
- **Point it at a local or staging backend,** never production. renderlint loads every page it finds at several widths, and a real admin session crawling a real backend can reach anything that admin can.
- **Saved sessions** (`contextOptions.storageState`, Playwright's `--save-storage`) are credentials. Keep them out of git.

## `.gitignore`

```gitignore
.renderlint/          # reports, screenshots, coverage, the server-mock file (init adds this)
.auth/                # saved Playwright sessions, if you use them
```

Commit `renderlint.config.json`, your fixtures, `.claude/skills/` and the `AGENTS.md` section. They contain no secrets if you follow the rules above.

## Playwright and Storybook

- The Playwright fixture checks the page your test already has open, then puts it back (size, colour scheme, scroll, text, focus). Replays reuse the GET responses your test received; other requests go to the server your test uses.
- Pages on other origins (payment pages, identity providers) are never checked.
- `renderlint storybook` only opens Storybook's own iframe pages.

## Reporting a problem

If you find a way renderlint could change data, leak a credential, or reach beyond the app under test, please open an issue at [github.com/ngocanhnckh/renderlint](https://github.com/ngocanhnckh/renderlint/issues). Mark it as security-related, or contact the maintainer privately first.
