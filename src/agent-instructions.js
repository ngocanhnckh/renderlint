// renderlint-ignore-file (describes placeholder/emoji rules, so it mentions their trigger words)
// Text written into AGENTS.md / CLAUDE.md by `renderlint init`.
export const START = '<!-- renderlint:start -->';
export const END = '<!-- renderlint:end -->';

export function agentSection(cmd = 'npx renderlint') {
  return `${START}
## UI quality gate: renderlint

This project uses **renderlint** to catch visual UI defects that type checks and code review miss: text overflowing its box, low contrast, overlapping elements and chart labels, layouts that break on phones, emoji used as icons, leaked \`undefined\`/\`NaN\`, broken or stretched images, hidden content, missing focus states. It renders the app in a real browser at phone, tablet and desktop widths (and dark mode) and reports every defect with the element, the source component/file when available, and a fix hint.

**Required workflow for coding agents**
1. After any change to UI code (components, pages, styles, templates), run \`${cmd}\` and fix **every error** before you say the task is done. Re-run until it reports \`0 errors\`. Treat it like a failing build.
2. Fix root causes in the layout. Do not hide symptoms: no \`overflow: hidden\` on the page to mask horizontal scrolling, no deleting content or shrinking text to dodge a rule.
3. Never use emoji as icons or decoration. Use an SVG icon library (e.g. lucide / heroicons / phosphor / tabler packages for your framework).
4. If a finding is genuinely intentional, mark that element with \`data-renderlint-ignore="<rule>"\` plus \`data-renderlint-reason="why"\` (or CSS \`--renderlint-ignore: <rule>;\`). Use this rarely; it is reviewed like an \`eslint-disable\`.
5. Annotated screenshots of every finding are written to \`.renderlint/screens/\`. Look at them when a finding is unclear. \`${cmd} explain <rule>\` describes any rule.

**Get it right the first time**
- Text must always be able to wrap: avoid fixed heights and widths on text containers, give flex/grid children \`min-width: 0\`, and use \`overflow-wrap: anywhere\` (Tailwind \`break-words\`) where long words, emails or URLs can appear. Assume real content is longer than your sample copy.
- Build mobile-first: rows wrap (\`flex-wrap\`), grids collapse (\`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3\`), and nothing has a fixed pixel width wider than 320px.
- Contrast: body text needs at least 4.5:1, large text 3:1. Light text on light accent colors (white on yellow, sky, lime, or light purple) almost always fails. Check text placed over images and gradients, and check dark mode.
- Charts and diagrams: leave margins for axis labels, limit the number of ticks, and rotate, abbreviate or wrap long labels so they never overlap or get clipped.
- Every interactive element needs a visible \`:focus-visible\` style, an accessible name (\`aria-label\` on icon-only buttons), and a hit area of at least 24×24px (44×44px on touch).
- No placeholder leaks: format numbers and dates and handle \`null\` values so the UI never shows \`undefined\`, \`NaN\`, \`[object Object]\`, \`Invalid Date\` or lorem ipsum.

Warnings (\`fragile-layout\` = breaks when text is 50% longer, small tap targets, tiny text…) don't fail the run, but fix them when it's cheap.

Commands: \`${cmd}\` (auto-detects the dev server or build output), \`${cmd} http://localhost:3000\`, \`${cmd} dist\`, \`${cmd} --pages /,/pricing\`, \`${cmd} --json\`.
${END}
`;
}

export function upsertSection(existing, section) {
  if (!existing) return section;
  const s = existing.indexOf(START), e = existing.indexOf(END);
  if (s !== -1 && e !== -1) return existing.slice(0, s) + section.trim() + existing.slice(e + END.length);
  return existing.replace(/\s*$/, '\n\n') + section;
}
