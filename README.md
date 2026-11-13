<h1 align="center">renderlint</h1>

<p align="center"><b>A linter for the rendered UI.</b> It opens your app in a real browser, finds the visual defects coding agents ship, and fails the build until they're fixed.</p>

<p align="center">
  <a href="https://github.com/ngocanhnckh/renderlint/actions/workflows/ci.yml"><img src="https://github.com/ngocanhnckh/renderlint/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.17-brightgreen.svg" alt="Node >= 18.17">
  <img src="https://img.shields.io/badge/framework-any-8b5cf6.svg" alt="Any framework">
</p>

![Six overflow bugs renderlint caught: a long email running off its card, a total cut off only at 1024px, a heading running off a phone screen, chart labels cut off by the SVG edge, a heading clipped by its card, a feature list spilling out of a pricing card](docs/images/hero-overflow.png)
<p align="center"><sub>Six times text didn't fit its box, each one renderlint's own annotated screenshot: from example pages, from apps Claude built in headless sessions, and from an Elementor page. More in the <a href="docs/gallery.md">gallery</a>.</sub></p>

Text spilling out of cards, gray-on-gray captions, chart labels on top of each other, a layout that only breaks at 1024px, a dropdown arrow jammed against the border, `$undefined` in a KPI tile, emoji where icons should be. TypeScript and ESLint can't see any of this, because the code is fine. It's the *pixels* that are wrong.

renderlint renders every page at phone, tablet and desktop widths (and dark mode), sweeps the widths in between, and re-checks with longer text, bigger numbers and longer API data. Each defect is reported with the element, the source file, an annotated screenshot and a concrete fix, in plain text an agent can act on.

## Quick start

**Paste this into your coding agent** (Claude Code, Cursor, Codex, Copilot, Gemini CLI, Windsurf, Aider, Zed, Amp…):

> Set up renderlint in this project: run `npx -y @yitec/renderlint init`, then follow the "UI quality gate: renderlint" section it adds to AGENTS.md: after every UI change run `npx renderlint` and fix every reported error until it shows 0 errors.

Or run it yourself:

```bash
npx -y @yitec/renderlint init   # one-time setup: installs it, adds config, build gate, agent instructions, Claude Code hook
npx renderlint                        # check: exits 1 if any error is found
```

Or just install it: `npm i -D @yitec/renderlint`. The command is `renderlint` either way. To try it once without installing: `npx -y @yitec/renderlint http://localhost:3000`.

Not sure what your app needs (a login, roles, server rendering, hundreds of pages)? [Getting started](docs/getting-started.md) picks the setup for your situation, and there's a page for each [framework](docs/frameworks/README.md).

```
✖ contrast (3)  Text does not have enough contrast with what is actually behind it …
  error Low text contrast: 2.66:1, needs 4.5:1 — #ffffff on a non-uniform background (≈#459bf4).
        at #top > section.hero > div.hero-copy > a.pill > b  "New"
        in Hero — src/components/Hero.tsx:42
        page / · all viewports · see .renderlint/screens/index@375.png #3
       fix use text #2e2e2e (currently #ffffff on #459bf4)

✖ text-clipped (1)  Text is partially cut off by an `overflow: hidden` container …
  error Text is cut off by an overflow:hidden container (12px past the right edge).
        at div.kpis > div.kpi:nth-of-type(1) > div.v  "$4,939.27"
        page /usage · at 1024px · see .renderlint/screens/usage@1024.png #1

✖ 4 error(s), 2 warning(s) · screenshots in .renderlint/screens
```

## What's new in 0.2.0

- **Pages that look frozen.** renderlint slows each page's API requests down, as a slow network would, and flags every area that stays blank while it waits: no spinner, no skeleton, no "Loading…". It also flags content that jumps when the data arrives. [More](#loading-states-and-the-ux-pass)
- **A deep UX pass: `--ux`.** It clicks every kind of button, tab, link, filter dropdown and form on each page (filling forms with test data), the way a user would. It reports clicks that get no response for a second, failures nobody is told about (it answers the requests with HTTP 500), forms that submit twice, buttons that do nothing, and freezes over 500ms. Writes never reach your server. [More](#loading-states-and-the-ux-pass)
- **Empty lists, dialogs and the Back button.** `--ux` also loads each page as a brand-new account would see it (every list empty) and flags lists that are just blank, spinners that never stop and pages that crash. It checks that dialogs take focus, close on Escape and hand focus back, and that Back after an in-app link really goes back. [More](#loading-states-and-the-ux-pass)
- **Every page, every role.** Routes are read from your source (Next.js, Nuxt, SvelteKit, Astro, React Router / Remix, TanStack Router, Angular, Vue Router) and from the running router, and dynamic routes like `/products/:id` are filled with real ids. With `roles`, each page is checked as admin, viewer and so on, all at once. A coverage report gives every route a status, so no page is skipped silently. [More](#every-page-of-a-big-app)
- **Pages behind a login, with no backend.** Set the token your route guard reads and mock the API, or log in through the real form. Server-rendered apps (Next.js, Nuxt, SvelteKit, Remix, Angular SSR) get the same `mock` on the server, so `middleware.ts` and loaders run too. A page that only showed the login form or "Access denied" is reported, never passed. [More](#pages-behind-a-login)
- **Content no one can scroll to.** A page area that grows past a fixed-height app shell (`height: 100vh; overflow: hidden`) without becoming a scroller, a card that hides the rest of its list, or `body { overflow: hidden }` left on: the content is there but can never be seen. `unreachable-content` finds it and turns the mouse wheel over it to make sure, so a script that scrolls the box doesn't count. [See it](#see-it)
- **Menus you can't see.** renderlint opens each dropdown, menu and combobox on the page and checks that its options can be seen. It catches a menu drawn underneath the next card (and names the ancestor whose z-index traps it), and one cut off by a card's `overflow: hidden` or a table's scroll box. Tested on Radix, Headless UI and Bootstrap.
- **No more `alert()` and `confirm()`.** The new `native-dialog` rule flags the browser's grey system boxes, both when one opens and in source (so the ones behind a click are caught too), and says what to use instead: a toast, an inline message or the app's own modal.
- **Skills for coding agents.** `init` installs three Claude Code skills: setting up every page and role, fixing findings, and Playwright and Storybook. Each finding says what to change, so the agent can fix it without asking. [More](docs/agents.md)
- **Playwright and Storybook.** `withRenderlint(test)` checks each state your e2e tests reach (dialogs open, step 2 of a wizard). `renderlint storybook` checks every story. [Playwright](docs/playwright.md) · [Storybook](docs/storybook.md)
- **About twice as fast.** Pages are checked side by side, identical pages share their checks, and contrast on a flat background needs no screenshot.

Everything else is in the [changelog](CHANGELOG.md).

## Contents

- [What's new in 0.2.0](#whats-new-in-020)
- [What it catches](#what-it-catches)
- [Loading states and the UX pass](#loading-states-and-the-ux-pass)
- [Content you didn't render](#content-you-didnt-render)
- [How it compares](#how-it-compares)
- [Does it work?](#does-it-work)
- [See it](#see-it)
- [Every page of a big app](#every-page-of-a-big-app)
- [Pages behind a login](#pages-behind-a-login)
- [WordPress and Elementor](#wordpress-and-elementor)
- [Make it impossible to ship defects](#make-it-impossible-to-ship-defects)
- [Intentional? Say so.](#intentional-say-so)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Limitations](#limitations)
- Docs: [getting started](docs/getting-started.md) · [frameworks](docs/frameworks/README.md) · [rules](docs/rules.md) · [configuration](docs/configuration.md) · [authentication](docs/authentication.md) · [roles and coverage](docs/roles-and-coverage.md) · [server mocks](docs/server-mocks.md) · [Playwright](docs/playwright.md) · [Storybook](docs/storybook.md) · [integrations](docs/integrations.md) · [coding agents](docs/agents.md) · [security](docs/security.md) · [WordPress](docs/wordpress.md) · [gallery](docs/gallery.md) · [results](docs/results.md) · [changelog](CHANGELOG.md)

## What it catches

52 rules, tuned so that a finding is almost always a real defect.

| What you see | renderlint rule |
|---|---|
| Longer text pokes out of a card, button or badge, or runs right up to its border | `text-overflow`, `text-clipped`, `text-crowding` |
| A layout that fits today's sample copy but breaks with real data | `fragile-layout` |
| Gray-on-gray or white-on-yellow text you can barely read | `contrast` (measured from real pixels, so it works on gradients and images) |
| Elements overlap when the window shrinks, instead of wrapping | `element-overlap`, `viewport-overflow`, `content-overflow` |
| Chart and diagram labels collide or get cut off | `text-overlap`, `text-clipped` (works on SVG charts) |
| A page or tab you can't scroll: content painted past an `overflow: hidden` app shell, a fixed-height card hiding the rest of its list, a scroll lock left on | `unreachable-content` (renderlint turns the mouse wheel to make sure) |
| A fixed header covers the hero, or a decoration covers a button | `obscured-content` |
| A dropdown or menu that opens behind the next card, or gets cut off by its card or a table's scroll box (z-index, `overflow: hidden`) | `popup-obscured` (renderlint opens each menu to check) |
| 🚀✨✅ emoji instead of a proper icon set | `emoji` (rendered DOM and source files) |
| `undefined`, `NaN`, `[object Object]`, `Invalid Date`, lorem ipsum | `placeholder-text` |
| Broken or stretched images, giant unsized SVG icons | `broken-image`, `image-distortion`, `oversized-icon` |
| A dropdown arrow on the border, a checkbox floating above its label, an icon over the placeholder, a squashed input | `dropdown-arrow`, `checkbox-layout`, `input-icon-overlap`, `squashed-control` |
| An input and its button at different heights, an icon sitting higher than its text | `control-height-mismatch`, `icon-misaligned` |
| `alert("Saved!")`, `confirm("Delete?")`: the browser's grey system box instead of the app's own toast or modal | `native-dialog` (when one opens, and in source, so the ones behind a click are caught too) |
| A dashboard card that stays blank while its data loads, then pops in; content that jumps when it arrives | `loading-state`, `layout-shift` (renderlint holds the requests for a second to see) |
| With `--ux`: a click that seems to do nothing for a second, a failed save nobody is told about, a form that submits twice, a dead button, a 2-second freeze | `action-feedback`, `error-feedback`, `double-submit`, `dead-control`, `ui-freeze`, `slow-render` |
| With `--ux`: a new account sees an empty table with no message (or a crash), a modal that ignores Escape and loses focus, a Back button that doesn't go back | `empty-state`, `dialog-focus`, `back-navigation` |
| Scroll-reveal sections that never appear on phones | `invisible-content` |
| No viewport meta, a pointless 3px scrollbar, `href="#"` links | `missing-viewport-meta`, `accidental-scrollbar`, `dead-link` |
| No focus ring, icon buttons with no label, tiny tap targets and text | `focus-indicator`, `unlabeled-control`, `tap-target`, `font-size-min` |
| Hydration errors, crashes, 404s, pages that only showed the login form or "Access denied" | `page-error`, `console-error`, `broken-resource`, `auth-required`, `page-not-shown` |

All rules, their defaults and fix guidance: [docs/rules.md](docs/rules.md). `npx renderlint explain <rule>` prints the same in the terminal.

## Loading states and the UX pass

On a fast dev machine the API answers in 50ms, so a page with no loading state looks fine. On a phone on a train, the same page sits blank for three seconds and looks broken. renderlint shows you that page.

<table>
<tr>
<td width="50%"><img src="docs/images/demo-ui-freeze.gif" alt="renderlint --ux clicks Generate report; the page freezes for 1.5 seconds; renderlint prints a ui-freeze warning naming the button"><br><sub><code>ui-freeze</code>: the click blocks the page for 1.5s.</sub></td>
<td width="50%"><img src="docs/images/demo-loading-state.gif" alt="The page's API requests are held for a second and the page shows nothing; then the data arrives and renderlint prints a loading-state warning"><br><sub><code>loading-state</code>: nothing on screen while the data loads.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/demo-error-feedback.gif" alt="renderlint fills the form with test data and clicks Save changes; it answers the request with HTTP 500 and the page says nothing"><br><sub><code>error-feedback</code>: the save fails and nobody is told.</sub></td>
<td width="50%"><img src="docs/images/demo-empty-state.gif" alt="renderlint answers the orders request with an empty list; the page shows table headers and nothing else"><br><sub><code>empty-state</code>: a new account sees an empty table, no message.</sub></td>
</tr>
<tr>
<td width="50%"><img src="docs/images/demo-dialog-focus.gif" alt="renderlint clicks Invite member, a modal opens; focus stays behind it and Escape does not close it"><br><sub><code>dialog-focus</code>: the modal ignores Escape and keyboard focus.</sub></td>
<td width="50%"></td>
</tr>
</table>

**Every run:** each page that loads data in the browser is reloaded with its `fetch`/XHR requests held for one second. renderlint looks at the page, releases the requests, and finds the areas the data filled. An area that showed nothing meanwhile is a `loading-state` warning. Any loading sign on the page counts: a skeleton, a spinner (including canvas and SVG ones, and spinners with hashed class names), a progress bar, "Loading…" text, `aria-busy`, or anything moving on screen.

![renderlint's screenshot of a dashboard: while the orders request is held, the Recent orders card is empty (boxed in red); once the data arrives, the table fills it](docs/images/ux-loading-state.png)

**`--ux`:** on each page, every kind of button, tab, in-app link, filter dropdown and form (filled with test data) is used on a fresh load, one of each repeated kind:

| What happens | Rule | Threshold |
|---|---|---|
| The click starts a request, and nothing on screen changes for a second | `action-feedback` | 1s: users lose the feeling that the page responds ([Nielsen](https://www.nngroup.com/articles/response-times-3-important-limits/)) |
| The area it fills stays blank meanwhile | `loading-state` | as above |
| renderlint answers the request with HTTP 500, and nothing says so (or the spinner never stops) | `error-feedback` | |
| A second click while the first is pending sends the request again | `double-submit` | |
| The button does nothing visible: no request, no change, no navigation | `dead-control` | |
| The page can't respond or repaint (a long task) | `ui-freeze` | 500ms ([INP "poor"](https://web.dev/articles/inp)) |
| The page's main content appears late | `slow-render` | 4s ([LCP "poor"](https://web.dev/articles/lcp)) |
| Content jumps when the data arrives | `layout-shift` | 0.1 ([CLS "good"](https://web.dev/articles/cls)) |
| With every list in its API responses emptied (a new account), a list is just blank, its spinner never stops, or the page crashes | `empty-state` | a section hidden entirely, title and all, is fine |
| A dialog the click opens leaves focus behind it, ignores Escape, or drops focus to the top of the page when it closes | `dialog-focus` | [WAI-ARIA dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), WCAG 2.4.3 |
| After an in-app link, Back skips the page (history replaced) or changes the address but not the page | `back-navigation` | |

<table>
<tr>
<td width="50%"><img src="docs/images/ux-action-feedback.png" alt="Clicking the Orders link: one second later the page is unchanged, because a React Router loader is still fetching and nothing shows it"><br><sub><code>action-feedback</code>: a React Router loader is fetching, and the page shows no sign of it.</sub></td>
<td width="50%"><img src="docs/images/ux-error-feedback.png" alt="The orders request answered with HTTP 500: the spinner keeps spinning and no error is shown"><br><sub><code>error-feedback</code>: the request failed and the spinner keeps spinning.</sub></td>
</tr>
</table>

Requests that change data (POST, PUT, PATCH, DELETE) are answered by renderlint with `200 {}` and never reach your server. Logout links and "Sign out" buttons are skipped. Every finding is a warning, and its message names the request, the control and what to add.

```
warn  action-feedback  After clicking the link "Orders", nothing on screen changed for 1s while GET /api/orders
                       was loading (renderlint held it, as on a slow network): the page looks frozen and users click
                       again or leave. Respond at once: show the pending state on the control (spinner, "Saving…",
                       disabled) or where the result will appear (skeleton, dimmed old content, a top progress bar
                       for page changes), then the result.
```

**How well does it work?** We measured it on 75 dashboard pages written in React (hooks, TanStack Query, React Router loaders, Suspense, class components), with XHR and in plain HTML. 24 of those pages were written by a separate agent that never saw the detector. renderlint caught every missing loading state and every click with no feedback, and never flagged a page that showed a skeleton, spinner, progress bar, delayed spinner or dimmed content. The benchmark and its results are in [docs/results.md](docs/results.md#loading-states-and---ux).

## Content you didn't render

Most layout bugs show up with content nobody had on screen during development. renderlint generates those cases instead of waiting for production to find them:

| Check | What renderlint does |
|---|---|
| **Width sweep** | Re-runs the layout rules at 13 widths from 320 to 1920px and on both sides of every breakpoint the page uses, so a grid that only breaks at 1024px, or right above its `max-width: 900px` breakpoint, is caught (`@1024px` in the report, with its own screenshot). |
| **Longer text** | Lengthens every text by 50%. |
| **Long words** | Turns emails, URLs, domains and IDs into 36+ character strings with no break points. |
| **Big numbers** | Gives KPIs, prices and counters three more digits. |
| **Longer API data** | If the page fetched JSON, reloads it with longer names, titles and emails in every response. |
| **Declared worst cases** | `data-renderlint-maxlength="60"` or `data-renderlint-sample="…"` on an element tests exactly that content, and failures are errors. |
| **States and mocks** | `states` opens menus and dialogs, fills forms, or serves empty and failing API responses before checking. |

![KPI cards: fine at 1280px, the spend value cut off at 1024px and boxed by renderlint](docs/images/demo-sweep.png)

> [!TIP]
> When a field has a known limit, declare it: `<h3 data-renderlint-maxlength="60">{project.name}</h3>`. The attribute does nothing in production. See [docs/configuration.md](docs/configuration.md#content-you-didnt-render) for `states` and `mock`.

## How it compares

renderlint doesn't replace your other tools. It covers the gap between "the code is valid" and "the page looks right".

| | Reads | Catches overflow, overlap, clipping | Contrast over gradients and images | Needs a baseline | Tells you the fix |
|---|---|---|---|---|---|
| **ESLint, stylelint, TypeScript** | Source code | No | No | No | Yes, for code issues |
| **axe-core, Lighthouse** | DOM and computed CSS | No | Reported as "needs review" | No | Yes, for a11y rules |
| **Visual regression** (Percy, Chromatic, BackstopJS, Playwright screenshots) | Pixels, against approved images | Only as a diff from the baseline | Only as a diff | Yes: a defect in the first version becomes the baseline | No: shows *what changed*, not *what's wrong* |
| **renderlint** | Rendered geometry and pixels | Yes, at every width and with stressed content | Yes, from the real pixels behind each glyph | No | Yes: element, source file, screenshot and fix |

Visual regression testing is still the right tool for catching unintended *changes* to a design you've approved. renderlint catches defects in a page nobody has approved yet, which is what an agent produces every time.

## Does it work?

We ran 22 headless Claude Code sessions (Opus and Haiku), each building a typical frontend: landing pages, dashboards, a kanban board, a weather app, an SVG org chart and analytics charts, in HTML, React, Next.js, Vue and Svelte. Half of them also got the one-line setup prompt above.

- The **11 baseline apps had 229 errors** between them: mostly WCAG contrast failures, plus emoji icons and clipped chart labels.
- **All 11 apps built with renderlint finished at 0 errors**, because the agents fixed the issues themselves.
- Rescored later with the width sweep, the extra stress profiles and the form rules, the renderlint-built apps show **11 errors in 5 apps**. All of them are real and none were checkable at the time (9 only appear at 320–360px). The baselines show 225 errors.

![Same weather-app prompt in two Claude Code sessions: 42 contrast errors without renderlint, 0 with it](docs/images/compare-weather.png)
<p align="center"><sub>The same weather-app prompt in two sessions. Left: no renderlint, 42 errors (its annotated report). Right: the session that ran renderlint and fixed its own findings.</sub></p>

Details, per-app numbers and lessons: [docs/results.md](docs/results.md).

## See it

Every run saves annotated screenshots with each finding boxed and numbered, so agents with vision (and humans) can see what's wrong.

<table>
<tr>
<td width="50%"><img src="docs/images/demo-charts.png" alt="Bar-chart labels overlapping and donut labels cut off by the SVG edge"><br><sub>Colliding bar-chart labels (<code>text-overlap</code>) and donut labels cut off by the SVG edge (<code>text-clipped</code>).</sub></td>
<td width="50%"><img src="docs/images/compare-donut.png" alt="Donut labels clipped at 375px without renderlint, wrapped with it"><br><sub>A real Haiku session: donut labels clipped on phones, then fixed.</sub></td>
</tr>
<tr>
<td><img src="docs/images/demo-kpis.png" alt="KPI tiles showing $undefined, NaN% and Invalid Date"><br><sub>Leaked <code>$undefined</code>, <code>NaN%</code> and <code>Invalid Date</code> (<code>placeholder-text</code>).</sub></td>
<td><img src="docs/images/demo-team.png" alt="Broken avatar, squashed avatar and an unsized icon grown to 204px"><br><sub>Broken and squashed images, and an unsized 24×24 icon at 204px.</sub></td>
</tr>
</table>

<img src="docs/images/demo-unreachable.png" alt="Left: a run dashboard whose Findings tab stops at the screen edge with no scrollbar. Right: the same tab without the clipping, most of it shaded as never reachable, next to renderlint's unreachable-content finding">
<sub>A tab inside a fixed-height app shell that never became a scroller: everything past the screen edge is painted but can't be reached (<code>unreachable-content</code>). renderlint names the box and how far the content goes.</sub>

<img src="docs/images/demo-forms-annotated.png" alt="An alert-settings form: native select arrows on the border, a checkbox stretched above its label, and a search icon over the placeholder, each boxed by renderlint">
<sub>Form controls that render but are built wrong: native select arrows on the border (<code>dropdown-arrow</code>), a checkbox stretched away from its label (<code>checkbox-layout</code>), a search icon over the placeholder (<code>input-icon-overlap</code>).</sub>

<p align="center"><img src="docs/images/dev-overlay.png" width="720" alt="renderlint's dev overlay on a React dashboard, listing findings with source file and line"><br><sub>The Vite plugin's live overlay: hover a finding to highlight it. Each finding links to its component file and line.</sub></p>

More, including a deliberately broken [demo page](examples/demo/index.html) that triggers 22 rules: [docs/gallery.md](docs/gallery.md).

## Usage

Without config, `renderlint` works out what to check: a running dev server, then your `dev` script (started and stopped for you), then a build folder (`dist`, `build`, `out`…), then `index.html`. You can also point it at a target:

```bash
npx renderlint http://localhost:3000            # any running app
npx renderlint dist                             # a static build (served for you)
npx renderlint index.html about.html            # plain files
npx renderlint --serve "npm run preview" --url http://localhost:4173
npx renderlint --pages /,/pricing,/dashboard --viewports 360,768,1440
npx renderlint --sweep 1024,1366                # only these extra widths (--no-sweep to skip)
npx renderlint --ux                             # also click through every page: feedback, errors, freezes
npx renderlint explain contrast                 # what a rule means and how to fix it
```

The output is plain text that agents can read. `--json`, `--format md` and `--format github` (PR annotations) are also available. Every run writes `.renderlint/report.json`, `.renderlint/report.md` and annotated screenshots to `.renderlint/screens/` (`--out <dir>` to change).

It doesn't care which framework you use. If it renders in a browser, renderlint can lint it: React, Next.js, Vue, Nuxt, Svelte/SvelteKit, Astro, Angular, Solid, Qwik, Remix, WordPress, plain HTML, and anything else.

## Every page of a big app

renderlint reads your app's routes from its source, without running it: Next.js (`app/` and `pages/`, route groups, parallel and intercepting routes), Nuxt, SvelteKit, Astro, React Router 7 and Remix (`routes.ts`, flat routes), TanStack Router, Angular (`Routes` arrays, lazy `loadChildren`), Vue Router and React Router configs. It adds `sitemap.xml` and build output, and fills dynamic routes such as `/products/:id` with real values: literal `generateStaticParams`/`getStaticPaths`, the build manifest, links it crawls, ids in your API's JSON lists, or `params` in the config. `npx renderlint routes` lists what it found.

Hundreds of URLs become a few dozen routes. Every instance of a route gets a quick check (narrowest viewport, base rules), and two per route get the full check (every viewport, stress, sweep, data stress): on a 260-URL Next.js shop that found 97% of the per-page errors of checking every URL fully, in half the time (`coverage: { quick: "ends" }` adds the widest viewport to the quick check: 100%, in 71%). Every route ends up in the report with a status, so none is skipped silently:

```
◐ Coverage 412 URL(s), 38 route(s): 35 checked, 2 need a role, 1 need param values
  needs a role /admin/users  app/admin/users/page.tsx — the page says "Access denied"
  needs param values /reports/:id  app/reports/[id]/page.tsx — no value for :id (…set "params")
```

`--min-coverage 100` (or `coverage.min`) fails CI when routes go unchecked, `--coverage-baseline` when a route that was checked no longer is. The agent hook re-checks only the routes an edit can affect, from the import graph of each page, plus any route that still had errors: on the same shop, a component edit took the hook 6–17 s instead of a 167 s full run, and across 30 typical edits it re-checked a third of the URLs without missing a page whose rendering changed (see [configuration](docs/configuration.md)).

## Pages behind a login

Without a session, an SPA sends every inner route to `/login`. renderlint reports those pages as `auth-required` instead of quietly checking the login form in their place. To check them, give it the token your route guard reads and mock the API: the inner pages render with nothing but the dev server running, and no credentials are involved.

```json
{
  "pages": ["/dashboard", "/accounts"],
  "auth": { "storage": { "sessionStorage": { "acme.token": "test-token" } } },
  "mock": { "**/api/me": { "name": "Dana" }, "**/api/accounts": "fixtures/accounts.json" }
}
```

It can also log in through your form once (`"auth": { "login": "/login", "user": "${RENDERLINT_USER}", "password": "${RENDERLINT_PASSWORD}" }`) or run a script for SSO. Hash routes (`/#/accounts`) are crawled as pages of their own, and log-out links are never followed.

With `"roles": { "admin": {…}, "viewer": {…} }`, every page is checked as each role, all roles at once (`/admin [role: admin]`). Routes come from your source and from your Vue, React Router or Angular router at runtime, so pages reached only with a button, and dynamic routes such as `/users/:id`, are checked too. A page a role isn't shown (a guard's redirect, HTTP 401/403, "Access denied" in place) is reported as `page-not-shown`, never passed. See [roles and coverage](docs/roles-and-coverage.md).

Server-rendered apps (Next.js, Nuxt, SvelteKit, React Router / Remix, Angular SSR) check the session and fetch data on the server. When renderlint starts the app, `mock` (and each role's) answers the server's own requests too, so the real login form, `middleware.ts`, `getServerSideProps` and loaders all run with no backend. See [server mocks](docs/server-mocks.md).

Dialogs, multi-step forms and other states behind clicks: your [Playwright tests](docs/playwright.md) already reach them, and renderlint can check each one in the test's own page. Components in isolation: [Storybook](docs/storybook.md).

renderlint never sends credentials anywhere, never opens log-out or destructive links (delete, cancel, unsubscribe…), and its server mocks only run on a loopback address. See [security](docs/security.md).

## WordPress and Elementor

Run `init` in a theme or plugin folder, or point renderlint at any WordPress URL. It finds the local site (wp-env, LocalWP, DDEV, Lando, Docker Compose), crawls the real pages and skips wp-admin, feeds and login. It also scans your PHP templates. Findings in Elementor content name the widget and link straight to the editor:

```
  error Text spills outside its container (456px past the right edge).
        at div.elementor-element-99731bd > h1.elementor-heading-title  "Unternehmensberatung für Designsysteme"
        in Elementor heading 99731bd in page #12 — edit: http://localhost:8888/wp-admin/post.php?post=12&action=elementor
```

It also catches what's specific to WordPress sites:
- sections an entrance animation never revealed, usually because an optimisation plugin delays Elementor's JavaScript;
- Elementor's default widget texts, and WordPress sample content;
- Elementor's default global colors, which fail contrast.

Setup, logged-in and WooCommerce pages, CI with wp-env and Elementor fixes: [docs/wordpress.md](docs/wordpress.md).

## Make it impossible to ship defects

renderlint exits non-zero when it finds errors, so you can gate any step on it:

| Where | How |
|---|---|
| **`npm run build`** (any framework) | `init` appends a check to your build script, e.g. `"build": "vite build && renderlint dist"` or `"build": "next build && renderlint --serve \"npx next start -p 4319\" --url http://localhost:4319"` |
| **Vite** (React, Vue, Svelte, Solid, Preact, Lit, Qwik…) | `import renderlint from '@yitec/renderlint/vite'` and add `renderlint()` to `plugins`. `vite build` fails on errors. In dev, an overlay shows findings live and prints them in the dev-server terminal, with source file:line. |
| **Claude Code** | `init` adds a `Stop` hook (`npx renderlint hook`). Claude can't end its turn while UI errors remain in files it changed. The hook only runs when UI files changed and gives up after 4 attempts, so it can't trap the agent. |
| **Other agents** | `init` writes the workflow into `AGENTS.md` (read by Codex, Cursor, Copilot, Gemini, Amp, Zed and others) and `CLAUDE.md`, and installs three [skills](docs/agents.md): setting up every page and role, fixing findings, Playwright and Storybook. |
| **Playwright Test** | `withRenderlint(test)` checks each state your e2e tests reach. See [docs/playwright.md](docs/playwright.md). |
| **CI** | `npx renderlint --format github` gives inline PR annotations. See [docs/integrations.md](docs/integrations.md). |
| **Any bundler, in dev** | `import('@yitec/renderlint/client').then((m) => m.start())` adds the live overlay to any app. |

<details>
<summary><b>What <code>init</code> does</b></summary>

1. Adds renderlint as a dev dependency (creating a `package.json` for plain HTML sites).
2. Writes `renderlint.config.json`, pointed at your dev command or static folder.
3. Adds a `lint:ui` script and appends the check to `build`, so builds fail on UI defects (`--no-build` to skip).
4. Installs the agent skills `renderlint-setup`, `renderlint-fix` and `renderlint-e2e` in `.claude/skills/` (`--no-skills` to skip). A skill you edited is left alone; `--force` replaces it.
5. Adds the agent workflow to `AGENTS.md`, pointing to the skills, and creates `CLAUDE.md` (which imports it) or adds the workflow to an existing one.
6. Installs the Claude Code Stop hook in `.claude/settings.json` (`--no-hook` to skip).
7. Adds `.renderlint/` to `.gitignore` and makes sure a headless Chromium is available.

`init` is idempotent, so you can run it again safely: it updates skills it installed earlier to the current version.
</details>

## Intentional? Say so.

Sometimes low contrast or clipped text is on purpose: a watermark, a teaser, a chat message containing emoji. Mark it the same way you'd write `!important` or `eslint-disable`:

```html
<div data-renderlint-ignore="emoji" data-renderlint-reason="user-generated chat">…</div>
<p data-renderlint-ignore>…</p>                          <!-- all rules, this subtree -->
```

```css
.watermark { --renderlint-ignore: contrast; }            /* works from CSS, inherits */
```

```js
const greeting = '👋 Welcome'; // renderlint-ignore emoji   (static source scan)
```

You can also ignore by selector or page in config: `"ignore": [{ "rule": "contrast", "selector": ".legal" }, { "rule": "dead-link", "page": "/blog/*" }]`.

> [!WARNING]
> An ignore is reviewed like an `eslint-disable`. The agent instructions tell agents to fix root causes first and to add a `data-renderlint-reason` whenever they ignore something.

## Configuration

`renderlint.config.json` (or `.js`/`.mjs`, or a `"renderlint"` key in `package.json`):

```json
{
  "serve": "npm run dev",
  "pages": ["/", "/pricing"],
  "viewports": [375, 768, 1280],
  "colorSchemes": "auto",
  "rules": { "line-length": "off", "tap-target": "error" },
  "ignore": [{ "rule": "contrast", "selector": ".legal-footnote" }],
  "states": [{ "name": "account menu", "click": "[aria-label=Account]", "waitFor": "[role=menu]" }],
  "mock": { "**/api/notifications*": [] }
}
```

All options, including the width sweep, stress profiles, states and mocks, crawling, WCAG AAA, timeouts and authenticated pages: [docs/configuration.md](docs/configuration.md).

## How it works

1. **Render.** Each page loads in headless Chromium at each viewport (and in dark mode if your CSS has `prefers-color-scheme: dark`). renderlint scrolls the page to trigger lazy content and scroll-reveal animations, waits for fonts and images, then jumps animations to their final state.
2. **Measure.** An analyzer runs in the page and checks geometry: the rects of every text run against its containers and clip boxes, box intersections, hit-testing (`elementsFromPoint`) for occlusion, and computed styles.
3. **Look at the pixels.** For contrast, the page is captured twice: once normally and once with all text made transparent. The second capture shows the real background behind each glyph, including gradients, images, translucent overlays and glass effects. Dropdown arrows are measured from pixels too, since the browser draws them outside the DOM.
4. **Stress.** The layout rules run again at the sweep widths, then with longer text, long words, bigger numbers, declared samples and longer API data. Anything that only breaks under stress becomes a `fragile-layout` warning.
5. **Report.** Findings are merged across viewports and pages, and repeats such as the same badge on 40 cards are grouped. Each is mapped back to a component or file where possible: React (including Server Components), Vue, Svelte and Astro dev builds. A fix hint and a numbered screenshot are attached.

It's tuned for a low false-positive rate. Things that are usually intentional are left alone: screen-reader-only text, `text-overflow: ellipsis`, `line-clamp`, closed accordions, off-canvas menus, carousels, scroll areas, overlapping avatar stacks, badges positioned outside cards, stacked-card illustrations, stretched links, modals and backdrops.

### Programmatic API

```js
import { check, formatPretty } from '@yitec/renderlint';

const result = await check({ targets: ['http://localhost:5173'], config: { viewports: [390, 1440] } });
console.log(formatPretty(result));
process.exit(result.ok ? 0 : 1);
```

## Limitations

- `<canvas>` charts (Chart.js, ECharts in canvas mode) are pixels, so their labels can't be inspected. Use an SVG renderer, or rely on your chart library's own label-collision handling.
- Pages are checked as they load, with each menu opened. What's behind other clicks (dialogs, tabs, filled forms) is rendered and judged by `--ux`, but its layout is only linted when you list it in `states` or reach it in a [Playwright test](docs/playwright.md). Pages behind a login need [`auth`](docs/authentication.md).
- `--ux` clicks one control of each kind per page, at most 12, each on a fresh load, so it takes about a minute per page. It doesn't use hover menus or drag and drop. `empty-state` empties the lists in the JSON the browser fetches; data a server renders into the HTML stays as it is.
- Server mocks are Node only. Pages a Django, Rails, Laravel or Go server renders need a running backend with test accounts ([other backends](docs/frameworks/other-backends.md)).
- Contrast follows WCAG 2 AA math. It doesn't model font weight beyond the large-text rule, and doesn't apply APCA.
- A single page takes about 4–10 seconds at three viewports with the sweep and stress passes. A site is faster per page: pages are checked side by side, and pages that render identically (an SPA's fallback route, duplicate URLs) share their checks. Use `--sweep 1024` or `--no-sweep` for a faster inner loop.

## Development

```bash
npm install
npm test                  # fixture suite: every rule must fire on its defect page and stay silent on clean pages
npm run build:client      # regenerate dist/ (browser bundle) after changing src/analyzer or src/client
node bin/renderlint.js test/fixtures/defects/contrast.html --no-crawl
```

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed. Mirror: [gitlab.com/anhnn.a05/renderlint](https://gitlab.com/anhnn.a05/renderlint).

## Star history

<a href="https://star-history.com/#ngocanhnckh/renderlint&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ngocanhnckh/renderlint&type=Date&theme=dark">
    <img alt="Star history of ngocanhnckh/renderlint" src="https://api.star-history.com/svg?repos=ngocanhnckh/renderlint&type=Date">
  </picture>
</a>
