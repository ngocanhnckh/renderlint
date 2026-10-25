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
| `stress` | `1.5` | Re-check with text lengthened by this factor and report `fragile-layout` warnings. `false` disables. |
| `scan` | `true` | Static scan of source files (emoji, lorem ipsum) in `src/`, `app/`, `pages/`, `components/`… |
| `scanDirs` | auto | Directories for the static scan. |
| `contrastLevel` | `"AA"` | `"AA"` (4.5:1 / 3:1) or `"AAA"` (7:1 / 4.5:1). |
| `minTapTarget` | `24` | Minimum target size in px (WCAG 2.5.8). |
| `minFontSize` | `12` | Minimum font size in px. |
| `maxLineLength` | `120` | Max average characters per line for paragraphs. |
| `screenshots` | `true` | Write annotated screenshots to `.renderlint/screens/`. |
| `outputDir` | `".renderlint"` | Where reports and screenshots go. |
| `concurrency` | `3` | Viewports checked in parallel. |
| `autoScroll` | `true` | Scroll through the page first (lazy content, reveal animations). |
| `reducedMotion` | `true` | Emulate `prefers-reduced-motion: reduce`. |
| `waitFor` | — | CSS selector to wait for before checking. |
| `delay` | `0` | Extra milliseconds to wait after load. |
| `timeout` | `30000` | Navigation timeout (ms). |
| `serverTimeout` | `120000` | How long to wait for `serve` to come up (ms). |
| `maxScreenshotHeight` | `12000` | Pages taller than this are only contrast-checked down to this height. |
| `beforeCheck` | — | JS config only: `async (page, { viewport, scheme }) => {}` — log in, open a menu, set state. `page` is a Playwright page. |
| `contextOptions` | — | Extra Playwright browser-context options (e.g. `storageState` for authenticated pages, `locale`). |

## Example: authenticated dashboard

```js
// renderlint.config.mjs
export default {
  serve: 'npm run dev',
  pages: ['/dashboard', '/settings'],
  contextOptions: { storageState: '.auth/state.json' },
  rules: { 'dead-link': 'off' },
};
```

## Example: strict

```json
{ "failOn": "warn", "contrastLevel": "AAA", "minTapTarget": 44, "rules": { "focus-indicator": "error", "tap-target": "error" } }
```
