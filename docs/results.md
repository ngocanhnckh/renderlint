# Does it work? Experiments with real coding-agent sessions

To find out whether renderlint helps agents ship a correct UI first time, we ran headless **Claude Code** sessions (`claude -p`) that each vibe-coded a frontend from a single prompt, in two conditions:

- **baseline**: just the prompt.
- **with renderlint**: the same prompt plus the setup sentence from the README ("run `npx renderlint init`, then follow the 'UI quality gate: renderlint' section…").

Every resulting app was then re-scored with the renderlint 0.1.0 build of the time (3 viewports, light and dark mode, stress pass). Findings were spot-checked by eye on the annotated screenshots to confirm they were real defects.

Screenshots of several of these apps, side by side, are in the [gallery](gallery.md).

## Round 1: five everyday frontends (Claude Opus)

| App | Stack | Baseline errors | With renderlint |
|---|---|---|---|
| SaaS landing page | single-file HTML | 39 (38 contrast, 1 emoji) | **0** |
| Designer portfolio | Next.js 16 + Tailwind v4 | 19 (contrast) | **0** |
| E-commerce admin dashboard | React + Vite + Tailwind + recharts | 28 (contrast, incl. chart axis labels) | **0** |
| Kanban board | Vue 3 + Vite | 10 (contrast) | **0** |
| Weather app with SVG chart | Svelte 5 + Vite | 42 (contrast, mostly light text on a blue gradient) | **0** |

## Round 2: prompts designed to provoke layout bugs (Claude Opus)

| App | Baseline errors | With renderlint |
|---|---|---|
| German B2B page (long compound words, 5-plan comparison table, 7-step SVG process diagram) | 22 (contrast) | **0** |
| SVG org chart + Gantt roadmap + team directory | 9 (contrast) | **0** |
| Marketing analytics (8-slice labelled donut, long campaign names, wide table) | 22 (contrast) | **0** |

## Round 3: a smaller, faster model (Claude Haiku)

| App | Baseline errors | With renderlint |
|---|---|---|
| SaaS landing page (single-file HTML) | 11 (contrast) | **0** |
| SVG org chart + Gantt roadmap | 11 (contrast) | **0** |
| Marketing analytics (recharts) | 16: 14 contrast, plus 2 **donut-chart labels cut off by the SVG edge** at 375px ("Organic Searc…", "…aid Social") | **0** |

**Total across all 22 sessions: 229 errors in the 11 baseline apps, 0 in the 11 apps built with renderlint.** Every renderlint-enabled session ended with the agent running the check and reaching 0 errors on its own. No human intervention was needed.

## Round 4: rescoring everything with the new checks

renderlint later gained a width sweep (13 widths from 320 to 1920px), more stress profiles (long words, big numbers, longer API data), `text-crowding` and five form-control rules. We rescored all 22 apps with that build, without touching the apps. The agents never saw these checks, so this shows what the checks add on top of what the agents already fixed.

| | Baseline apps (11) | Apps built with renderlint (11) |
|---|---|---|
| Errors at the time of the experiment | 229 | 0 |
| Errors with the new build | 225 | **11**, in 5 apps |
| …of which from the new checks | 11 | 11 |

- **Every new finding was checked by eye on the annotated screenshots.** All of them are real: text running through card padding to the border, a newsletter card overflowing the viewport at 320px, chart labels clipped by the SVG edge at 720px, donut labels colliding at 320px, native `<select>` arrows 3px from the border.
- **What the renderlint-built apps still had:** 9 errors only appear at 320 or 360px, narrower than the 375px phone viewport the agents were checking. The other 2 are `dropdown-arrow` on native selects. None of these was checkable when the sessions ran. With today's build the agent would get them in the same report as everything else.
- **The weather baseline went from 42 to 28 errors** because the app picks a day or night theme from the current time, and the rescore ran at night. The other baselines kept their old findings exactly.
- **Cost:** on a typical page the width sweep adds 1.5–2 seconds and the stress passes about 0.5 seconds (5.7s instead of 3.8s for the React dashboard, 11.0s instead of 8.3s for the German B2B page).
- **Speed-up (later):** across the 22 benchmark targets a full run went from 289s to 138s wall time (0.48×) and 280s to 161s CPU, with no finding lost. The time came from:
  - checking pages side by side and sharing checks between identical pages (a 12-page landing site: 101s → 12s);
  - waiting for the page to go quiet instead of a fixed network-idle delay;
  - faster screenshot encoding, and skipping screenshots that show nothing new;
  - measuring contrast from styles where the background provably is one flat colour.

  The same change sweeps both sides of each breakpoint the page uses. It found 4 more real defects, for example a price cut off at 901px just above a `max-width: 900px` breakpoint.

## Loading states and `--ux`

The loading checks were designed by measurement. We wrote a benchmark of dashboard pages and tried several ways to detect a missing loading state, scoring each on how many broken pages it caught and how many correct pages it flagged by mistake.

**The benchmark.** There are 75 pages on a Vite + React 19 app whose API answers in 60ms, like a dev machine:
- **41 pages we wrote.** They cover page loads, clicks, React Router transitions and main-thread freezes, built with hooks, TanStack Query, Suspense, React Router loaders and plain HTML with `fetch`.
- **24 blind pages.** A separate agent wrote them without seeing the detector, using its own styles: class components, `useReducer`, XHR, a hand-written SWR hook, canvas and MUI-style SVG spinners, skeletons with inline styles only, an NProgress-style bar, modals, drawers and accordions that fetch.
- **10 pages for the other `--ux` checks:** error handling, dead buttons, double submits, layout shift and slow renders.

Each page is labelled "should be flagged", "fine" or "ambiguous". Ambiguous pages, such as stat cards that show `0` or `—` until the numbers arrive, aren't scored.

**How detection works.** Every method holds the page's fetch/XHR requests, looks at the page while it waits, releases the requests, and finds the content the data brought in. Content counts as new when it is text, an image or a painted box that wasn't on screen before. It is grouped by the container it went into. The methods differ in what counts as "the user saw something meanwhile":

| Method | Own set: caught · false alarms | Blind set: caught · false alarms |
|---|---|---|
| Loading words and ARIA only (`aria-busy`, `role=progressbar`, "Loading…") | 13/13 · 12 | 12/12 · 3 |
| Pixels only (anything moving, or a non-blank area) | 13/13 · 3 | 12/12 · 3 |
| DOM: the above plus running CSS animations, loader-like class names, and placeholder boxes that disappear when the data arrives | 13/13 · 0 | 12/12 · 1 |
| **DOM + motion on screen (shipped)** | **13/13 · 0** | **12/12 · 0** |

- **The DOM method's one blind miss:** an NProgress-style bar animated from JavaScript, with no CSS animation and no telling class name. Comparing two frames 250ms apart catches it, along with canvas spinners.
- **Pixels alone fall short:** on their own they flagged a small "Loading…" line and static grey skeleton cards, because the area around them was still mostly empty.

**When to look.** We look at the page 1s into the wait. Looking at 400ms gave the same scores for the shipped method, but the DOM-only method then flagged a page that deliberately shows its spinner only after 400ms, a common way to avoid a flash on fast responses. One second is also Nielsen's limit for keeping the user's flow.

**renderlint itself on the benchmark:**
- **Default run at 375px.** It flagged all 13 broken page loads (7 in our set, 6 in the blind set) and nothing on the other 52 pages. Broken clicks are left to `--ux`, because the default run doesn't click. It costs about 2.5s per page that loads data in the browser, and nothing on pages that don't.
- **`--ux` at 1280px.** It caught every broken click and route change: 6 in our set and 6 in the blind set. That includes React Router loaders with no pending UI, a TanStack Query mutation with no pending state, and modals and accordions that open only after their fetch. It caught both main-thread freezes (1.2s on load and 1.5s on a click). Apart from `error-feedback` (next point), it flagged nothing on the pages labelled fine.
- **The one layout-shift miss at 375px:** a promo banner added above the table measured CLS 0.093 there, just under the 0.1 threshold. At 1280px it measured 0.11 and was flagged.
- **What `--ux` adds:** `error-feedback` on 11 pages that show a loading state but never handle a failed request. When their request fails, they keep spinning forever, show an empty table, or even show "Settings saved", because the code never checks `response.ok`. We checked these against the source, and they are real.
- **Cost:** `--ux` takes 5–15s per page on the benchmark, about 3 page loads per action, at most 12 actions per page.

### Empty lists, dialogs and the Back button

These `--ux` checks were added later, with 23 more pages (`bench/loading/app/v.json`): 10 for empty states, 6 for dialogs, 4 for the Back button and 3 for filter dropdowns. Each check has bad pages and pages that do it right in a different way.

| Check | Pages | Flagged correctly | False alarms |
|---|---|---|---|
| `empty-state`: a table with only its headers, a grid with nothing under its heading, a page that crashes on `items[0]`, a spinner that never stops on `[]`, "Orders (0)" above an empty table | 5 bad · 5 fine | 5/5 | 0 |
| `dialog-focus`: a hand-made modal with no focus handling, one that ignores Escape, one that drops focus when it closes | 3 bad · 3 fine | 3/3 | 0 |
| `back-navigation`: `<Link replace>`, and `history.pushState` with no `popstate` handling | 2 bad · 2 fine | 2/2 | 0 |
| Filter dropdowns (`action-feedback`): a `<select>` that refetches with nothing shown | 1 bad · 2 fine | 1/1 | 0 |

- **Correct pages it left alone:** an empty state with a message and a button, TanStack Query's empty branch, a section hidden entirely (title and all) when it has nothing, a redirect to onboarding, a chart whose data is plain numbers, `<dialog>` with `showModal()`, a React modal that manages focus by hand, a small `role=dialog` popover, React Router `<Link>`s, and tabs kept in `?tab=` with `replace` (only the query changes).
- **On the 75 earlier pages:** `empty-state` flagged 37. None of them has an empty branch in its source: each maps over the list and shows a bare table or nothing when the list is empty. `dialog-focus` flagged the two modals of the blind set, and both are real: neither moves focus nor closes on Escape. `back-navigation` flagged nothing, including the four React Router pages. The other rules gave the same results as before.
- **How the empty page is made:** in every JSON response, each non-empty array of records becomes `[]`, and counters next to it (`total`, `count`, `hasMore`…) are set to match. A record is an object with an id (`id`, `uuid`, `slug`, `orderId`…) or a GraphQL edge. Menus, permissions, chart points and plain values are kept, so the page isn't broken in a way no real user would see. Messages are matched to lists by where they sit in the page (tag, stable id and class from `<body>` down), not by position on screen, because an empty list shrinks and the cards under it move up. Generated ids, hashed classes and state classes (`is-empty`, `list--loading`) are left out of that match. Text such as "No failed jobs" or "Start by uploading a file" counts as an empty-state message, even though it contains an error or loading word.
- **Which dialogs:** only modal ones (`aria-modal`, `<dialog>` opened with `showModal()`, `alertdialog`, or a dialog over a full-screen overlay), so a cookie banner that appears during the wait isn't blamed on the click. Focus that drops to the page is reported only when the control that opened the dialog is still there and can take focus. renderlint never clicks "OK" or "Done" to close one.
- **Push or replace:** Chromium's Navigation API gives the index of the current history entry. A link that pushes moves to a new index, and one that replaces stays on the same one. `history.length` can't tell them apart once there are forward entries, because a push truncates them.

## What we learned

- **Frontier models mostly get layout right but fail contrast all the time.** In every Opus baseline, almost all the defects were WCAG contrast failures: muted gray captions, orange-600 labels on white, white text on light accent colors, chart axis ticks, text on gradients. They're hard to see on a good monitor and easy to miss in review. Once the agent had numbers (`2.66:1, needs 4.5:1 — #ffffff on #459bf4`) and a suggested color, it fixed them in one pass.
- **The agents used the tool as intended.** They ran `init`, read the report, looked at the screenshots, fixed root causes (darker brand colors and avatar gradients, an orders table that caused a scrollbar at 1280px, labels that wrapped inside buttons), and re-ran until clean. When the Svelte agent hit a renderlint false positive, it suppressed it with `data-renderlint-ignore` plus a written reason and reported the problem. It has since been fixed.
- **The agents also found bugs in renderlint, and those were fixed:**
  - A hydration race with Next.js dev servers. renderlint briefly set an inline style on `<html>`; it now never mutates the document before analysis.
  - Cards scrolled out of view inside a horizontal strip were counted as overlapping. Overlap checks now use only the visible, clipped part of each box.
- **False positives found during the experiments were eliminated.** Examples: mid-animation colors, fade masks on scroll areas, `<col>` highlights, `currentColor` logo shapes, the Next.js dev badge, one-sided borders. Fixes are covered by regression fixtures in `test/fixtures/clean/`.

## Reproduce

```bash
claude -p "<your app prompt> Also: set up renderlint by running \`npx -y github:ngocanhnckh/renderlint init\`, then follow the 'UI quality gate: renderlint' section it adds to AGENTS.md." --dangerously-skip-permissions
npx renderlint --json   # score the result
```
