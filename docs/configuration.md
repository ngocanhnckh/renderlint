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
| `maxPages` | `12` | Page limit when crawling. |
| `exclude` | `[]` | Path globs to skip while crawling, e.g. `"/blog/*"`. |
| `viewports` | `[375, 768, 1280]` | Widths, or `"WxH"` strings, or `{ width, height }`. |
| `colorSchemes` | `"auto"` | `"auto"` checks dark mode too when the app has `prefers-color-scheme: dark` CSS. Or `["light"]`, `["light","dark"]`. |
| `rules` | `{}` | Per-rule severity: `"error"`, `"warn"`, `"off"`. |
| `ignore` | `[]` | `[{ rule?, selector?, page?, message? }]` — suppress matching findings. `selector` entries are applied in the page (element and descendants). |
| `failOn` | `"error"` | `"error"`, `"warn"` (warnings fail too) or `"never"`. |
| `stress` | `1.5` | Re-check with stressed content (longer text by this factor, long unbreakable words, bigger numbers, declared samples) and report `fragile-layout`. `false` disables. See [Content you didn't render](#content-you-didnt-render). |
| `sweep` | `true` | Also run the layout rules at 13 widths between 320 and 1920 px (each assigned to the nearest viewport). A list such as `[1024, 1366]` replaces the set; `false` disables. CLI: `--sweep 1024,1366`, `--no-sweep`. |
| `stressData` | `true` | When a page fetched JSON, reload it once with every string in the API responses lengthened and re-check. CLI: `--no-stress-data`. |
| `states` | `[]` | UI states that don't render on load: `[{ name, page?, click?, hover?, fill?, press?, waitFor?, delay?, mock?, run? }]`. Each is checked like a page. |
| `mock` | `{}` | Serve these API responses instead of the real ones: `{ "**/api/orders*": "fixtures/orders.json" }`, `{ status, json }`, or the data itself. |
| `scan` | `true` | Static scan of source files (emoji, lorem ipsum) in `src/`, `app/`, `pages/`, `components/`… |
| `scanDirs` | auto | Directories for the static scan. |
| `contrastLevel` | `"AA"` | `"AA"` (4.5:1 / 3:1) or `"AAA"` (7:1 / 4.5:1). |
| `minTapTarget` | `24` | Minimum target size in px (WCAG 2.5.8). |
| `minFontSize` | `12` | Minimum font size in px. |
| `maxLineLength` | `120` | Max average characters per line for paragraphs. |
| `screenshots` | `true` | Write annotated screenshots to `.renderlint/screens/`. |
| `outputDir` | `".renderlint"` | Where reports and screenshots go (CLI: `--out <dir>`). |
| `concurrency` | `3` | Viewports checked in parallel. |
| `autoScroll` | `true` | Scroll through the page first (lazy content, reveal animations). |
| `reducedMotion` | `true` | Emulate `prefers-reduced-motion: reduce`. |
| `waitFor` | — | CSS selector to wait for before checking. |
| `delay` | `0` | Extra milliseconds to wait after load. |
| `timeout` | `30000` | Navigation timeout (ms). |
| `serverTimeout` | `120000` | How long to wait for `serve` to come up (ms). |
| `maxScreenshotHeight` | `12000` | Pages taller than this are only contrast-checked down to this height. |
| `beforeCheck` | — | JS config only: `async (page, { viewport, scheme }) => {}` — log in, open a menu, set state. `page` is a Playwright page. |
| `auth` | — | Pages behind a login. `{ storage: { sessionStorage, localStorage, cookies } }` sets the token the route guard reads (frontend only, with `mock` for the API); `{ login: "/login", user: "${RENDERLINT_USER}", password: "${RENDERLINT_PASSWORD}" }` logs in once; `{ run: async (page) => {} }` (JS config) for SSO. See [authentication](authentication.md). |
| `contextOptions` | — | Extra Playwright browser-context options (e.g. `locale`, `storageState`). |

## Content you didn't render

Most layout bugs show up with content nobody had on screen during development: a customer name twice as long, an email with no spaces, a balance with seven digits, an empty or failed API call, a dialog that only opens on click, a width between the breakpoints. renderlint generates those cases itself.

| Check | What changes | Reported as |
|---|---|---|
| Responsive sweep | Width set to 320, 360, 414, 480, 600, 720, 900, 1024, 1100, 1366, 1440, 1536, 1920 px; layout rules re-run at each | The normal rule (error/warn), labelled `@1024px`, with its own screenshot |
| `longer` | Every text node gets `stress`× more words | `fragile-layout` (warn) |
| `long-words` | Emails, URLs, domains and IDs become 36+ character unbreakable tokens | `fragile-layout` (warn) |
| `big-numbers` | Numbers (KPIs, prices, counters) get three more digits, `12,400` → `12,400,000` | `fragile-layout` (warn) |
| `declared` | Elements with `data-renderlint-sample` / `data-renderlint-maxlength` get that content | `fragile-layout` (**error**: you declared it can happen) |
| Data stress | The page is reloaded with longer strings in every JSON response from `fetch`/XHR (names, titles, emails; ids, enums, URLs and dates are left alone) | `fragile-layout` (warn) |
| `states` / `mock` | Clicks, hovers, form input, or substituted API responses before checking | All rules, on a page labelled `path [state: name]` |

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
