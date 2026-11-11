# Changelog

## 0.2.0 (2026-10-31)

The first version published to npm, as `@yitec/renderlint`.

### Pages behind a login, and roles

- `auth`: check inner pages frontend-only (the token the route guard reads, plus `mock` for the API), log in through the real form, or run a script for SSO. Unsigned test tokens with `{ "$jwt": { … } }`.
- `roles`: every page is checked as each role, all roles at once. Each role takes its own sign-in settings, `mock`, `pages` it must see and paths it must not (`deny`). The report shows a route × role table.
- New rules: `auth-required` (a page sent to the sign-in page) and `page-not-shown` (a role was redirected, got 401/403, or saw "Access denied" in place of the page). Neither is ever counted as a pass.
- `mockFrom`: answer the API from the project's MSW handlers or a HAR recording.

### Every page

- Routes are read from the source (Next.js, Nuxt, SvelteKit, Astro, Remix / React Router 7, TanStack Router, Angular, Vue Router, React Router) and from the running router. They are also read from `sitemap.xml` and the build output. Dynamic routes are filled from the app's data, links or `params`.
- Coverage: every instance of a route gets a quick check, and a few varied ones get the full check. `coverage.json` gives every route a status and the reason it wasn't checked; `--min-coverage` and `--coverage-baseline` gate CI.
- The Claude Code hook re-checks only the routes an edit can affect, from each page's import graph.
- `renderlint routes` lists the routes found.

### Server-rendered apps

- `mock` also answers the requests the server makes when renderlint starts the app (`fetch`, undici, `node:http`), through a preload that only runs on a loopback address. It was tested on Next.js (App and Pages), Nuxt, SvelteKit, Remix / React Router 7 and Angular SSR, with the real login form and no backend.

### Tests and components

- Playwright Test: `withRenderlint(test)` checks the pages and states your e2e tests reach, and a reporter collects them (`@yitec/renderlint/playwright`, `/playwright/reporter`).
- `renderlint storybook`: every story, in its own iframe, after its play function.
- Content behind an open modal is skipped.

### Coding agents

- `init` installs three skills in `.claude/skills/`:
  - `renderlint-setup`: every page and every role;
  - `renderlint-fix`: fixing findings;
  - `renderlint-e2e`: Playwright and Storybook.

  It updates copies it installed earlier, and leaves edited ones alone unless you pass `--force`. Pass `--no-skills` to skip them. `AGENTS.md` points to them.

### Other changes

- `--cdp <url>` (or `RENDERLINT_CDP`, `cdp` in config): use a Chromium that is already running instead of launching one. Scrollbars are hidden on each page, only renderlint's own contexts are closed, and a browser that can't reach this machine gets the local site's requests from renderlint (#1).
- WordPress and Elementor: local site detection, crawling, PHP template scan, Elementor widget names and editor links.
- New rule `loading-state` (warning): each page that loads data in the browser is reloaded with its fetch/XHR requests held for a second, as on a slow network. An area that the data fills and that showed nothing meanwhile is reported, with the request, the container, a sample of the content and a side-by-side screenshot of both moments. Spinners, skeletons, progress bars, "Loading…" text, `aria-busy` and anything moving on screen all count. `loading: false` / `--no-loading` turns it off.
- New rule `layout-shift` (warning): content jumps when the data arrives (CLS over 0.1, measured during the same reload).
- `--ux` (`"ux": true`): a deep UX pass that clicks every kind of button, tab, in-app link and form (with test data) on each page, each on a fresh load. New warnings: `action-feedback` (nothing on screen changes for a second after a click that starts a request), `error-feedback` (renderlint answers the requests with HTTP 500 and nothing says so, or the spinner never stops; also for the page's own data), `double-submit`, `dead-control`, `ui-freeze` (a long task of 500ms or more, on load or after a click) and `slow-render` (LCP over 4s). Requests that change data are answered by renderlint and never reach the server. `alert()`/`confirm()` behind a click are reported as `native-dialog`. Filter dropdowns (`<select>` outside a form) are used too.
- `--ux` checks three more things, as warnings: `empty-state` (the page loaded with every list of records in its JSON responses emptied, as for a new account: a list that is just blank, a spinner that never stops, or a crash), `dialog-focus` (a dialog a click opens keeps focus behind it, ignores Escape, or drops focus when it closes) and `back-navigation` (after an in-app link, Back skips the page or changes only the address).
- New rule `popup-obscured`: renderlint opens each menu, dropdown and combobox trigger (two of each repeated kind) and checks that the options can be seen. It reports a menu cut off by an ancestor's overflow, following containing blocks (a transformed ancestor traps a `position: fixed` menu), and one drawn underneath a later element, naming the ancestor whose stacking context traps it. Menus already open in `states` and Playwright tests are checked too. Each finding has its own screenshot of the open menu. `menus: false` turns the opening off.
- New rule `native-dialog`: `alert()`, `confirm()` and `prompt()`, when one opens while a page is checked (with where it was called; confirm and prompt are answered Cancel) and in source files, so the ones behind a click are caught too. A `useConfirm()` hook, a component's own `confirm()` method and Angular/Vue template bindings are not flagged.
- Form-control rules: dropdown arrows, checkboxes, input icons and control heights. `viewport-overflow` also catches text that runs past the viewport out of a box that fits.
- Speed: pages are checked side by side, and identical renderings share their checks. Contrast is computed without pixels on a flat background, and the sweep covers both sides of each breakpoint.
- Destructive links (delete, cancel, unsubscribe…) and log-out links are never followed. A literal password in the config is reported.
- React Router: a hash router file next to a browser router no longer doubles every page (`/dashboard` and `/#/dashboard`). Components declared in the router file are found.

### Fixes

- A `display: contents` element is never a container boundary: it draws no box, even when its CSS has a border or background (#4).
- `dead-link`: a Bootstrap 4/5 toggle (`data-toggle` / `data-bs-toggle`) whose target is on the page is live, even though its click handler is delegated to `document` (#3).
- Elementor atomic (v4) elements are mapped to their widget and editor link: they have `data-id` and `data-e-type` but no `elementor-element` class (#2).

### Docs

- New pages: getting started, a page per framework, roles and coverage, server mocks, Playwright, Storybook, security, and coding agents.

## 0.1.0 (2026-10-25)

- First version, not published to npm. It included:
  - the in-page analyzer, the runner and the CLI;
  - the Vite plugin, the client overlay, `init`, the Claude Code hook and `watch`;
  - reports in pretty, JSON, Markdown and GitHub formats;
  - annotated screenshots.
