# Configuration

renderlint looks for `renderlint.config.js`, `renderlint.config.mjs`, `renderlint.config.cjs`, `renderlint.config.json`, `.renderlintrc.json`, or a `"renderlint"` key in `package.json`. CLI flags override the file.

| Option | Default | Description |
|---|---|---|
| `url` | — | Base URL of an already-running app. Combined with `serve`, the server is only started if the URL is not reachable. |
| `serve` | — | Command that starts a server, e.g. `"npm run dev"`. The URL is detected from its output (`Local: http://localhost:5173`) unless `url` is set. The process is stopped afterwards. |
| `dir` | — | Static directory to serve (SPA fallback to `index.html`). |
| `base` | — | Public base path the build expects, e.g. `"/my-repo/"` (Vite `base`, GitHub Pages). The Vite plugin passes it automatically. CLI: `--base`. |
| `pages` | `["/"]` | Entry pages (paths or absolute URLs). |
| `crawl` | `true` | Follow same-origin links found on checked pages. |
| `maxPages` | `12` / all routes | Page limit, per role. Without routes from the source: 12. When renderlint finds the app's routes, every planned page (each route, up to `coverage.perRoute` instances of each dynamic route) is checked unless you set a limit; routes over the limit are listed as "not checked" in the coverage report. |
| `routes` | auto | Route coverage: read the app's routes from its source without running it (Next.js `app/` and `pages/`, Nuxt `pages/`, SvelteKit `src/routes`, Astro `src/pages`, React Router 7 `routes.ts` and flat routes, Remix, TanStack Router, Angular `Routes` arrays with lazy `loadChildren`, Vue Router `routes`, React Router `createBrowserRouter`/`<Routes>`), plus `sitemap.xml`/`robots.txt` and build output (`.next/prerender-manifest.json`, prerendered HTML). When the source names no routes (a build without its source, routes built at runtime), the route table is read from the app's router while it runs (Vue Router, React Router, Angular Router, dev servers and production builds). Every route is checked or listed with the reason it wasn't. On when crawling; `false` turns it off (links only). CLI: `--no-routes`; `renderlint routes [--files]` lists what was found. |
| `params` | `{}` | Values for dynamic routes nothing links to: `{ "/products/:id": ["a1", "b2"], "/docs/:slug+": ["intro/install"] }` (or objects for several params), or by parameter name: `{ "slug": "hello-world" }`. Other sources, used automatically: literal `generateStaticParams`/`getStaticPaths`/`entries`, Astro content collections, the build manifest, the sitemap, links seen while crawling, and ids/slugs in the JSON lists the app's API returns (`/api/users` → `/users/:id`). |
| `coverage` | `{}` | `{ perRoute: 2, quick: true, quickMax: 2000, min, ignore, baseline }`. `perRoute`: instances of each route that get the full check. `quick`: every other known instance gets a quick check (narrowest viewport, light scheme, no stress, sweep or data stress), and the instances most unlike the first one by what it measured (longest unbroken word, most text, overflow, broken images, a different layout) get the remaining full checks; `"ends"` adds the widest viewport to the quick check (catches desktop-only parts of a page); `false` checks only `perRoute` instances, the first found. `quickMax`: quick checks per run. `min`: fail when fewer than this percentage of routes were checked (CLI `--min-coverage 100`). `ignore`: route patterns left out on purpose (`["/admin/*"]`). `baseline`: path of an earlier `coverage.json`; fails when a route checked there is not checked now (CLI `--coverage-baseline`). Every run writes `.renderlint/coverage.json` and `.renderlint/page-map.json` (route → files it renders, used by the agent hook to re-check only the routes an edit affects). |
| `exclude` | `[]` | Path globs to skip while crawling, e.g. `"/blog/*"`. |
| `viewports` | `[375, 768, 1280]` | Widths, or `"WxH"` strings, or `{ width, height }`. |
| `colorSchemes` | `"auto"` | `"auto"` checks dark mode too when the app has `prefers-color-scheme: dark` CSS. Or `["light"]`, `["light","dark"]`. |
| `rules` | `{}` | Per-rule severity: `"error"`, `"warn"`, `"off"`. |
| `ignore` | `[]` | `[{ rule?, selector?, page?, message? }]` — suppress matching findings. `selector` entries are applied in the page (element and descendants). |
| `failOn` | `"error"` | `"error"`, `"warn"` (warnings fail too) or `"never"`. |
| `stress` | `1.5` | Re-check with stressed content (longer text by this factor, long unbreakable words, bigger numbers, declared samples) and report `fragile-layout`. `false` disables. See [Content you didn't render](#content-you-didnt-render). |
| `sweep` | `true` | Also run the layout rules at 13 widths between 320 and 1920 px, plus both sides of every width breakpoint the page uses (each assigned to the nearest viewport). A list such as `[1024, 1366]` replaces the set and is used as is; `false` disables. CLI: `--sweep 1024,1366`, `--no-sweep`. |
| `sweepBreakpoints` | `true` | With `sweep: true`, also check the two widths around each breakpoint in the page's CSS media queries (`min-width`, `max-width`, `width >= …`, in `<link media>` and `<source media>` too) and in the media queries its JS passes to `matchMedia()`: `(min-width: 1024px)` adds 1023 and 1024. Container queries are not included (they depend on the container, not the viewport). `false` keeps only the 13 widths. |
| `stressData` | `true` | When a page fetched JSON, reload it once with every string in the API responses lengthened and re-check. CLI: `--no-stress-data`. |
| `states` | `[]` | UI states that don't render on load: `[{ name, page?, click?, hover?, fill?, press?, waitFor?, delay?, mock?, run? }]`. Each is checked like a page. |
| `mock` | `{}` | Serve these API responses instead of the real ones: `{ "**/api/orders*": "fixtures/orders.json" }`, `{ status, json }`, or the data itself. |
| `mockFrom` | `[]` | Answer the API from what the project already has: its MSW handlers (`"src/mocks/handlers.ts"`, msw 2.x; TypeScript is compiled with the project's esbuild) or a HAR recording (`"recordings/app.har"`: only its JSON responses, matched by method and URL, then without the query, then by path on any host). Explicit `mock` entries win. Data stress and state mocks apply to these responses too. With `mockFrom`, an API request none of them answers that then fails (4xx/5xx other than 401/403) is a `broken-resource` warning, so a page checked without its data is not passed silently. |
| `scan` | `true` | Static scan of source files (emoji, lorem ipsum) in `src/`, `app/`, `pages/`, `components/`… |
| `scanDirs` | auto | Directories for the static scan. |
| `contrastLevel` | `"AA"` | `"AA"` (4.5:1 / 3:1) or `"AAA"` (7:1 / 4.5:1). |
| `minTapTarget` | `24` | Minimum target size in px (WCAG 2.5.8). |
| `minFontSize` | `12` | Minimum font size in px. |
| `maxLineLength` | `120` | Max average characters per line for paragraphs. |
| `screenshots` | `true` | Write annotated screenshots to `.renderlint/screens/`. Each finding links to the first screenshot that marks it, so a viewport, sweep width or dark-mode run whose marked findings all appear on an earlier screenshot writes none. |
| `outputDir` | `".renderlint"` | Where reports and screenshots go (CLI: `--out <dir>`). |
| `concurrency` | 3–6 | Browser contexts checked in parallel: each page × viewport × color scheme is one. Default: half the CPU cores, at least 3 and at most 6. Pages overlap: the next page starts while earlier ones are still in their stress and sweep passes. CLI: `--concurrency`. |
| `dedupe` | `true` | A page that renders exactly like one checked before (same DOM, text, form values, element boxes, canvas pixels and loaded resources, at the same viewport and color scheme: SPA fallbacks, `/` and `/index.html`, duplicate URLs) gets the first page's contrast, dropdown, stress, sweep and data-stress findings instead of running those checks again; its own load, analysis, focus check and screenshot still run. `"template"` also checks pages that share an earlier page's skeleton (tags and classes, ignoring text and the number of repeated siblings: blog posts, product pages) with the base checks only, without stress, sweep or data stress: faster on large sites, but a per-page defect that only shows at a sweep width or with stressed content is then missed. `false` checks every page fully. CLI: `--dedupe template`, `--dedupe off`. |
| `autoScroll` | `true` | Scroll through the page first (lazy content, reveal animations). |
| `reducedMotion` | `true` | Emulate `prefers-reduced-motion: reduce`. |
| `waitFor` | — | CSS selector to wait for before checking. |
| `delay` | `0` | Extra milliseconds to wait after load. |
| `timeout` | `30000` | Navigation timeout (ms). |
| `serverTimeout` | `120000` | How long to wait for `serve` to come up (ms). |
| `maxScreenshotHeight` | `12000` | Pages taller than this are only contrast-checked down to this height. |
| `beforeCheck` | — | JS config only: `async (page, { viewport, scheme }) => {}` — log in, open a menu, set state. `page` is a Playwright page. |
| `auth` | — | Pages behind a login. `{ storage: { sessionStorage, localStorage, cookies } }` sets the token the route guard reads (frontend only, with `mock` for the API); `{ login: "/login", user: "${RENDERLINT_USER}", password: "${RENDERLINT_PASSWORD}" }` logs in once; `{ run: async (page) => {} }` (JS config) for SSO. With `roles`, the settings every role shares. A password or real-looking token written out in the config file (not `${ENV}`) gets a warning. See [authentication](authentication.md). |
| `roles` | — | Check every page as each role, all roles at once: `{ "admin": { "storage"?, "login"?, …, "mock"?, "pages"?, "deny"? }, "viewer": { … } }`. A role's sign-in settings go over the top-level `auth` (none: the top-level `auth`; `"auth": null`: signed out); its `mock` goes over the top-level `mock`, in the browser and on the server; `pages` are pages it must see (checked as that role, an error when not shown); `deny` lists paths it is not meant to see (`["/admin/**"]`). Pages are reported as `/admin [role: admin]`, and the report shows a route × role table. A page one role sees and another doesn't is `page-not-shown`. `auth: { roles: … }` is accepted too. See [roles](authentication.md#every-page-as-every-role). |
| `serverMock` | `true` | When renderlint starts the server (`serve`, or the `dev` script), `mock` (and each role's and state's) also answers the requests the server makes (SSR: server components, loaders, `getServerSideProps`, Nuxt server routes), through a preload that only runs in the server renderlint starts and only answers requests to a loopback host. `false`: browser only. |
| `contextOptions` | — | Extra Playwright browser-context options (e.g. `locale`, `storageState`). |

## Content you didn't render

Most layout bugs show up with content nobody had on screen during development: a customer name twice as long, an email with no spaces, a balance with seven digits, an empty or failed API call, a dialog that only opens on click, a width between the breakpoints. renderlint generates those cases itself.

| Check | What changes | Reported as |
|---|---|---|
| Responsive sweep | Width set to 320, 360, 414, 480, 600, 720, 900, 1024, 1100, 1366, 1440, 1536, 1920 px and to both sides of each breakpoint the page uses (`max-width: 900px` → 900 and 901); layout rules re-run at each | The normal rule (error/warn), labelled `@1024px`, with its own screenshot (unless all its errors are already on an earlier one) |
| `longer` | Every text node gets `stress`× more words | `fragile-layout` (warn) |
| `long-words` | Emails, URLs, domains and IDs become 36+ character unbreakable tokens | `fragile-layout` (warn) |
| `big-numbers` | Numbers (KPIs, prices, counters) get three more digits, `12,400` → `12,400,000` | `fragile-layout` (warn) |
| `declared` | Elements with `data-renderlint-sample` / `data-renderlint-maxlength` get that content | `fragile-layout` (**error**: you declared it can happen) |
| Data stress | The page is reloaded with longer strings in every JSON response from `fetch`/XHR (names, titles, emails; ids, enums, URLs and dates are left alone) | `fragile-layout` (warn) |
| `states` / `mock` | Clicks, hovers, form input, or substituted API responses before checking | All rules, on a page labelled `path [state: name]` |

In dark mode the stress passes (not the sweep, which runs in light mode only) are skipped when they provably can't find anything new: every `prefers-color-scheme` rule only sets colors, backgrounds, shadows, outlines or custom properties holding colors, and the page has the same DOM, boxes and color opacities as in light mode. The light-mode `fragile-layout` findings are then reported for dark mode too.

### Declare your worst case

When you know a field's limit, say so in the markup. The attribute is inert in production.

```html
<h3 data-renderlint-maxlength="60">{project.name}</h3>
<span data-renderlint-sample="Aleksandra Wiśniewska-Kowalczyk">{user.name}</span>
```

### States and mocks

```js
// renderlint.config.mjs
export default {
  serve: 'npm run dev',
  states: [
    { name: 'user menu', page: '/', click: '[aria-label="Account"]', waitFor: '[role=menu]' },
    { name: 'new invoice dialog', page: '/invoices', click: 'text=New invoice', waitFor: '[role=dialog]' },
    { name: 'search filled', page: '/customers', fill: { 'input[type=search]': 'nonexistent customer' } },
    { name: 'empty inbox', page: '/inbox', mock: { '**/api/messages*': [] } },
    { name: 'orders error', page: '/orders', mock: { '**/api/orders*': { status: 500, json: { error: 'Internal error' } } } },
  ],
  mock: { '**/api/me': 'fixtures/me.json' },
};
```

A state without `page` uses the first entry page. `run: async (page) => {}` (JS config) handles anything else.

When a dialog is open (`aria-modal="true"`, or a `<dialog>` opened with `showModal()`), only the dialog is checked: the page behind it is inert and dimmed by the backdrop on purpose.

If your end-to-end tests already open these states, let them do it instead: see [Playwright Test](integrations.md#playwright-test). For API data the project already has, see `mockFrom` above:

```json
{ "mockFrom": ["src/mocks/handlers.ts"] }
```

## Example: authenticated dashboard

Frontend only: the token the route guard reads, and the API served from fixtures. No backend or credentials needed. More options in [authentication](authentication.md).

```json
{
  "serve": "npm start",
  "pages": ["/dashboard", "/settings"],
  "auth": { "storage": { "sessionStorage": { "auth.token": "test-token" } } },
  "mock": { "**/api/me": "fixtures/me.json", "**/api/projects*": "fixtures/projects.json" }
}
```

## Example: strict

```json
{ "failOn": "warn", "contrastLevel": "AAA", "minTapTarget": 44, "rules": { "focus-indicator": "error", "tap-target": "error" } }
```
