# Changelog

## Unreleased

### Adopting it on an existing app

- `renderlint baseline` writes today's findings to `renderlint-baseline.json`. While that file exists, runs fail only on findings that aren't in it; known ones are counted, not shown (`--no-baseline` shows them, `baseline: false` in the config ignores the file). Each run says how many baselined findings are fixed. Findings are matched by rule, element (or source file) and text, ignoring list positions, generated class names, line numbers and numbers in text. Pages that could not be loaded are never accepted, and `renderlint baseline <page>` keeps the entries of pages it did not check.
- Every run compares itself with the previous one: `Since the last run: 3 fixed, 1 new`, in the terminal, `report.md` and the Claude Code hook. Pages a run didn't check aren't counted as fixed.
- The agent instructions, the fix skill and the hook tell agents never to rewrite the baseline themselves.

### Phones

- New rule `zoom-disabled` (error): `user-scalable=no` or `maximum-scale` under 2 in the viewport meta, which stops people zooming in on phones (WCAG 1.4.4).
- New rule `input-zoom` (warn): at phone width, a text field, textarea or select the page sized below 16px, which iOS Safari zooms into when tapped. Fields left at the browser's default size are not judged, since iPhones use their own default.
- New rule `html-lang` (warn): `<html>` without a `lang` attribute (WCAG 3.1.1).
- New rule `safe-area` (warn): on a page with `viewport-fit=cover`, renderlint emulates an iPhone's status bar, notch and home indicator at phone width. It reports text and controls under them, at the top of the page or in a bar fixed to the bottom, that have no `env(safe-area-inset-*)` padding.

### Fixes

- Fewer false positives, all found on real sites:
  - **Covered text you can scroll clear of.** `obscured-content`, `element-overlap` and `contrast` no longer report text under something floating over it that scrolling moves it out from under: a code block's copy button, or a small fixed button such as a floating action button or chat bubble. Still reported: covers that are part of the layout, bars across the screen (a header over the hero, a cookie banner), and anything nothing can scroll clear of.
  - **Negative margins.** `content-overflow` no longer reports a box pulled up to 24px past its container by its own negative margin (VitePress's navbar menu). A box that is too wide, or pulled further, is still reported.
  - **Dev servers.** "Failed to fetch dynamically imported module" on a localhost dev server, usually a chunk still compiling, is now a warning with a hint, not an error. On a build renderlint serves itself it stays an error.
- Fix: findings seen only at some widths were labelled "all viewports" when their sweep widths happened to number as many as the configured viewports.
- Security docs list everything renderlint connects to and every program it runs ([docs/security.md](docs/security.md)), and a `SECURITY.md` says how to report a vulnerability privately. There is no telemetry.
- The fix skill tells agents to treat text quoted from a checked page as data, never as instructions.
- Code: regular expressions use `String.match`/`matchAll` instead of `RegExp.exec`, so security scanners stop reading them as shell commands. No change in behaviour.

## 0.2.0 (2026-11-18)

The first tagged release, and the first version for npm as `@yitec/renderlint`. Website: [renderlint.yitec.net](https://renderlint.yitec.net).

### Text that almost collides

- New rule `text-near-overlap` (warn): two pieces of text side by side, less than ¾ of the font size apart and out of line, where at least one sits in an absolutely or fixed positioned layer. The typical case is a centred empty-state message laid over a panel whose title is pinned top-left: at one width they nearly touch, at a narrower one they overlap. Text lined up with its neighbour, a label placed against the text it annotates (a "NEW" on a menu item, a unit after a price), text on its own badge, chip or tooltip, SVG charts and icon fonts are left out. On the 99 benchmark pages and every test page (201 pages in all), it reported nothing.

### Tooltips, keyboard focus, ARIA and cramped controls

Ideas taken from comparing renderlint with [lintapple](https://github.com/gholtzap/lintapple). renderlint missed 9 of the 12 defects on lintapple's demo page. The objective ones are covered now; the ones that only make sense against a design policy (font allowlist, type scale, alignment contracts) are not.

- `unreachable-content` also covers fixed panels and dialogs taller than the screen that don't scroll (the bottom and, for a centered dialog, the top are out of reach). Panels that are mostly off screen on purpose (closed drawers, sheets peeking from the bottom, toasts) are left out. While a dialog is open, only the dialog is checked.
- `popup-obscured` also covers tooltips. From 600px wide up, renderlint hovers each tooltip trigger and reports a tooltip that opens partly off the screen, is cut off, or is drawn underneath something. Triggers: controls tied to a `role="tooltip"`, the attributes tooltip libraries use, and icon-only buttons.
- New rule `tooltip-keyboard` (warn): a tooltip that doesn't open when its control gets keyboard focus, or doesn't close on Escape (WCAG 2.1.1, 1.4.13).
- New rule `focus-obscured` (warn): renderlint walks the page with Tab and Shift+Tab, and reports a focused control entirely hidden under a sticky or fixed layer (WCAG 2.4.11). Its screenshot is taken at that moment.
- New rule `aria-reference` (warn): `aria-labelledby`, `aria-describedby`, `aria-errormessage`, `aria-details`, `aria-activedescendant` or `<label for>` naming an id that doesn't exist.
- New rule `label-in-name` (warn): a button or link whose `aria-label` doesn't contain its visible text (WCAG 2.5.3). Select and combobox triggers, which show a value, are left out.
- New rule `cramped-control` (warn): a label within 3px of its button's border, two buttons 0.5–3.5px apart (or touching with rounded corners), or a button 0.5–3.5px from its card's edge. Button groups, segmented controls and input groups are left out.
- Contrast: text under a scroll container's border no longer counts as visible (overflow clips at the padding edge). This removed a false 1:1 finding in a scrolled `<dialog>`.

### Content no one can scroll to

- New rule `unreachable-content` (error). It flags content below the bottom of a box that clips (`overflow: hidden` or `clip`), or below the screen on a page that doesn't scroll, where nothing around it scrolls. Typical cases: a page or tab area that grows past a fixed-height app shell without being a scroller, a fixed-height card that hides the rest of its list, and a scroll lock left on. Before reporting, renderlint turns the mouse wheel over the box. Content that a script scrolls (custom scrollbars, scroll-jacking pages) is not reported, nor is content moved away on purpose (transformed, absolute or fixed), in small boxes, next to a "Show more" control, faded out, or behind an open dialog. `text-clipped` on the same box's bottom edge is folded into it. On 99 benchmark pages and the 50 existing test targets, it reported nothing new.

### Resource use

- `.renderlint/screens/` no longer keeps every screenshot ever written. A run removes the earlier screenshots of the pages it checks, or all earlier ones after a full crawl. In two real projects, 25 of 27 and 91 of 139 screenshots were left over from earlier runs.
- The default `concurrency` is 3 to 4 browser contexts, down from 3 to 6. More contexts finish sooner without saving any work: on a large app, 4 instead of 6 takes 61 s instead of 49 s and 1.1 GB instead of 1.4 GB at peak, for the same findings. It is also lowered when free memory is short (Linux and Windows; a container's limit with Node 20.13+). `--concurrency` still sets it.
- The contrast check builds the description of a text (selector, snippet, source) only when the text can be reported, instead of for every text on the page. A full run takes about 6% less CPU and 10% less time.

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

- A website at [renderlint.yitec.net](https://renderlint.yitec.net) with the rules, examples and a blog. The README is shorter and links to it.
- New pages: getting started, a page per framework, roles and coverage, server mocks, Playwright, Storybook, security, and coding agents.

## 0.1.0 (2026-10-25)

- First version, not published to npm. It included:
  - the in-page analyzer, the runner and the CLI;
  - the Vite plugin, the client overlay, `init`, the Claude Code hook and `watch`;
  - reports in pretty, JSON, Markdown and GitHub formats;
  - annotated screenshots.
