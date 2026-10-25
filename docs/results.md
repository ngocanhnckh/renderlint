# Does it work? Experiments with real coding-agent sessions

To find out whether renderlint helps agents ship a correct UI first time, we ran headless **Claude Code** sessions (`claude -p`) that each vibe-coded a frontend from a single prompt, in two conditions:

- **baseline**: just the prompt.
- **with renderlint**: the same prompt plus the setup sentence from the README ("run `npx renderlint init`, then follow the 'UI quality gate: renderlint' section…").

Every resulting app was then re-scored with the final renderlint 0.1.0 build (3 viewports, light and dark mode, stress pass). Findings were spot-checked by eye on the annotated screenshots to confirm they were real defects.

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
