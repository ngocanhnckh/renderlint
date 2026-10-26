# Gallery

Every renderlint run saves annotated screenshots to `.renderlint/screens/`. Each finding is boxed and numbered to match the text report, so a coding agent with vision (or a person) can see exactly what is wrong. The images below are crops of those screenshots.

## Same prompt, with and without renderlint

Each pair comes from two separate headless Claude Code sessions given the same app prompt. The left session got only the prompt. The right one also got the one-line renderlint setup prompt from the README, and fixed its own findings until the check passed. Details: [results.md](results.md).

**Weather app (Svelte 5, Claude Opus).** The baseline used pale blue-white text on a blue gradient: 42 contrast errors across light and dark mode.

![Weather app: 42 errors without renderlint, 0 with](images/compare-weather.png)

**Store dashboard (React + recharts, Claude Opus).** Gray chart axis ticks, a white-on-blue badge and button, and a gray sidebar heading: 28 errors.

![Dashboard: 28 errors without renderlint, 0 with](images/compare-dashboard.png)

**Marketing analytics (React + recharts, Claude Haiku).** At 375px the donut labels "Organic Search" and "Paid Social" run off the edge of the SVG. The renderlint session wrapped the labels so they fit.

![Donut chart: labels clipped at 375px without renderlint, wrapped with it](images/compare-donut.png)

## Every rule on one page

[`examples/demo/`](../examples/demo/index.html) is a deliberately broken SaaS page, written to contain the mistakes agents typically make. Run it yourself from a checkout of this repo:

```bash
npm install
node bin/renderlint.js examples/demo
```

It reports 38 errors and 7 warnings across 15 rules. Some of them:

| | |
|---|---|
| ![Hero at 375px with obscured pill, low-contrast copy and emoji icons](images/demo-hero.png) | **Phone, 375px.** The fixed header covers the "New" pill (`obscured-content`). The hero copy is `#94a3b8` on a near-white gradient, 2.35:1 (`contrast`). The feature list uses emoji as icons (`emoji`). |
| ![Pricing card at 375px with an unreadable badge and a CTA pushed into the next card](images/demo-pricing.png) | **Phone, 375px.** The "Most popular" badge is white on amber, 1.67:1. The fixed-height card can't hold six features, so its CTA is pushed into the next card, where it is hidden (`content-overflow`, `element-overlap`, `obscured-content`). The button's fixed width cuts off its own label (`text-clipped`). |
| ![Integrations table running off the right edge of a phone screen](images/demo-table.png) | **Phone, 375px.** A 680px table without a scroll wrapper makes the whole page scroll sideways (`viewport-overflow`). |

![Charts: bar-chart labels overlap and donut labels are clipped by the SVG edge](images/demo-charts.png)

**Desktop, 1280px.** Bar-chart labels collide (`text-overlap`). Donut labels and the first axis label are cut off by the SVG edge (`text-clipped`).

![KPI tiles showing $undefined, NaN% and Invalid Date](images/demo-kpis.png)

**KPI tiles wired to API data of the wrong shape:** `$undefined`, `NaN%`, `Invalid Date` (`placeholder-text`). The green deltas are 3.30:1 (`contrast`).

![Team cards: broken avatar, squashed avatar, huge unsized icon](images/demo-team.png)

**Team cards:** a 404 avatar (`broken-image`, `broken-resource`), a 2:1 image forced into a circle (`image-distortion`), and a 24×24 icon with no size that grows to 204px (`oversized-icon`).

## Live in the dev server

With the Vite plugin, findings appear in a corner overlay while you work. Hovering a finding highlights the element, and each one links back to the component file and line. The same list prints in the dev-server terminal, where coding agents read logs.

![The renderlint dev overlay on a React dashboard, listing contrast findings with source file and line](images/dev-overlay.png)
