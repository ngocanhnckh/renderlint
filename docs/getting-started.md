# Getting started

renderlint opens your app in a real browser at phone, tablet and desktop widths and reports visual defects. It finds text that doesn't fit its box, low contrast, overlapping elements, layouts that break on phones, and leaked `undefined`. This page gets you from install to "every page is checked".

## 1. Install

```bash
npx -y @ngocanhnckh/renderlint init
```

`init` does the following:
- adds the package as a dev dependency;
- writes `renderlint.config.json`;
- adds a `lint:ui` script and appends the check to `build`;
- writes the agent instructions in `AGENTS.md` and the skills in `.claude/skills/`;
- installs the Claude Code Stop hook;
- ignores `.renderlint/` in git.

Flags: `--no-build`, `--no-hook`, `--no-skills`, `--force` (replace edited skills). Then:

```bash
npx renderlint
```

With no config, renderlint finds a running dev server, else starts your `dev` script, else serves your build folder (`dist`, `build`, `out`…), else `index.html`.

## 2. Find your situation

| Your app | What to do | Page |
|---|---|---|
| Public pages only (marketing site, docs, static export) | Nothing more: renderlint crawls the links and reads the routes from your source. | [Static sites](frameworks/static.md) |
| A single-page app with a login (Angular, React, Vue) | Give renderlint a test token and mock the API: no backend, no credentials. | [Angular](frameworks/angular.md), [React](frameworks/react.md), [Vue](frameworks/vue.md) |
| Different pages per role (admin, viewer, free, paid) | List the roles; every page is checked as each of them, at once. | [Roles and coverage](roles-and-coverage.md) |
| Server-rendered with a Node server (Next.js, Nuxt, SvelteKit, React Router 7 / Remix, Angular SSR) | Your `mock` also answers the server's own requests when renderlint starts the server, so the real login form works with no backend. | [Next.js](frameworks/nextjs.md), [Nuxt](frameworks/nuxt.md), [SvelteKit](frameworks/sveltekit.md), [Remix / React Router 7](frameworks/remix.md), [Angular](frameworks/angular.md#ssr), [server mocks](server-mocks.md) |
| A non-Node backend renders the HTML (Django, Rails, Laravel, Go, PHP) | Test accounts per role against a seeded local or staging database. | [Other backends](frameworks/other-backends.md) |
| WordPress, Elementor | Point it at the local site; findings link to the Elementor widget. | [WordPress](wordpress.md) |
| Astro | Routes come from `src/pages`. | [Astro](frameworks/astro.md) |
| Hundreds of pages (shops, catalogs, CMS) | Route coverage checks a few varied instances of each route and quick-checks the rest. | [Roles and coverage](roles-and-coverage.md#hundreds-of-pages) |
| States behind clicks (dialogs, wizards, filled forms) | `states` in the config, or let your Playwright tests reach them. | [Configuration](configuration.md#states-and-mocks), [Playwright](playwright.md) |
| You have a Storybook | `npx renderlint storybook` checks every story. | [Storybook](storybook.md) |
| You have MSW handlers or a HAR recording | `"mockFrom": ["src/mocks/handlers.ts"]` reuses them as the API. | [Configuration](configuration.md) |

## 3. Make sure nothing was missed

Every run prints a coverage line and, with roles, a table of every route × role:

```
◐ Coverage 9 URL(s), 9 route(s): 6 checked, 1 redirect elsewhere, 2 not checked (66.7% of routes)
Pages by role (routes from the react-router router):
  route       admin     viewer
  /admin      checked   denied (expected)
  /billing    checked   Access denied
  /dashboard  checked   checked
```

`.renderlint/coverage.json` lists every route with its status and the reason. Work through the reasons until every route is checked or deliberately excluded. Then set `"coverage": { "min": 100 }` so CI fails if a later change loses pages. [Roles and coverage](roles-and-coverage.md#reading-the-coverage-report) explains each reason.

## 4. Keep it safe

renderlint is a test tool. It never writes into your build output, never follows links that look destructive, never submits forms other than the login form, and never needs your app's secrets. Read [Security](security.md) before pointing it at anything but a local or staging app.

## 5. Coding agents

`init` installs three skills that Claude Code loads, and any other agent reads through `AGENTS.md`:

- **renderlint-setup:** making every page checkable (login, roles, mocks, params, coverage);
- **renderlint-fix:** fixing findings at the root;
- **renderlint-e2e:** Playwright, Storybook, MSW and HAR.

See [Coding agents](agents.md).
