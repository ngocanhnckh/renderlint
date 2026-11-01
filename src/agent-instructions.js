// renderlint-ignore-file (describes placeholder/emoji rules, so it mentions their trigger words)
// Text written into AGENTS.md / CLAUDE.md by `renderlint init`.
export const START = '<!-- renderlint:start -->';
export const END = '<!-- renderlint:end -->';

export function agentSection(cmd = 'npx renderlint', { wordpress, skills } = {}) {
  return `${START}
## UI quality gate: renderlint

This project uses **renderlint** to catch visual UI defects that type checks and code review miss: text overflowing its box, low contrast, overlapping elements and chart labels, layouts that break on phones, emoji used as icons, leaked \`undefined\`/\`NaN\`, broken or stretched images, hidden content, misbuilt form controls (dropdown arrows on the border, stretched checkboxes, icons over input text), missing focus states. It renders the app in a real browser at phone, tablet and desktop widths, sweeps the widths in between, re-checks with longer text, long emails/URLs, bigger numbers and longer API data (and dark mode), and reports every defect with the element, the source component/file when available, and a fix hint.

**Required workflow for coding agents**
1. After any change to UI code (components, pages, styles, templates), run \`${cmd}\` and fix **every error** before you say the task is done. Re-run until it reports \`0 errors\`. Treat it like a failing build.
2. Fix root causes in the layout. Do not hide symptoms: no \`overflow: hidden\` on the page to mask horizontal scrolling, no deleting content or shrinking text to dodge a rule.
3. Never use emoji as icons or decoration. Use an SVG icon library (e.g. lucide / heroicons / phosphor / tabler packages for your framework).
4. If a finding is genuinely intentional, mark that element with \`data-renderlint-ignore="<rule>"\` plus \`data-renderlint-reason="why"\` (or CSS \`--renderlint-ignore: <rule>;\`); for a finding at a source line, a \`// renderlint-ignore <rule> -- why\` comment on the line above. Use this rarely; it is reviewed like an \`eslint-disable\`.
5. Annotated screenshots of every finding are written to \`.renderlint/screens/\`. Look at them when a finding is unclear. \`${cmd} explain <rule>\` describes any rule.
${skills ? skillsBlock(skills) : ''}
**Get it right the first time**
- Text must always be able to wrap: avoid fixed heights and widths on text containers, give flex/grid children \`min-width: 0\`, and use \`overflow-wrap: anywhere\` (Tailwind \`break-words\`) where long words, emails or URLs can appear. Assume real content is longer than your sample copy.
- Build mobile-first: rows wrap (\`flex-wrap\`), grids collapse (\`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3\`), and nothing has a fixed pixel width wider than 320px.
- Contrast: body text needs at least 4.5:1, large text 3:1. Light text on light accent colors (white on yellow, sky, lime, or light purple) almost always fails. Check text placed over images and gradients, and check dark mode.
- Charts and diagrams: leave margins for axis labels, limit the number of ticks, and rotate, abbreviate or wrap long labels so they never overlap or get clipped.
- Every interactive element needs a visible \`:focus-visible\` style, an accessible name (\`aria-label\` on icon-only buttons), and a hit area of at least 24×24px (44×44px on touch).
- Form controls: a native \`<select>\` draws its arrow next to the border whatever its \`padding-right\`, so styled selects need \`appearance: none\` and a chevron inset like the text (e.g. \`right 12px center\` with \`padding-right: 40px\`). Scope \`width: 100%\` input styles to text fields so checkboxes and radios stay small and sit beside their labels. Pad inputs on the side of any icon drawn inside them (\`pl-10\`). Give controls in the same row the same height, and center icons with their text (\`inline-flex items-center\`).
- Content you can't see: when a field has a known limit or a realistic worst case, declare it so renderlint tests it: \`data-renderlint-maxlength="60"\` or \`data-renderlint-sample="Aleksandra Wiśniewska-Kowalczyk"\` on the element that shows it. Keep text clear of the padding at every width, not just at 375/768/1280 (\`text-crowding\`, \`@1024px\` findings come from the width sweep).
- States behind interaction: add menus, dialogs, tabs, filled forms, and empty/error API states to \`states\` in \`renderlint.config.mjs\` (\`{ name, page, click, waitFor }\`, \`mock: { "**/api/items*": [] }\` for empty data, \`{ status: 500, json: {...} }\` for errors) so they get checked too.
- Pages behind a login, roles, dynamic routes: \`auth-required\`, \`page-not-shown\` or routes listed as not checked mean pages were never checked. Don't ask for credentials and don't turn those rules off: give renderlint a test session and API mocks in \`renderlint.config.json\` (frontend only, no backend), as the renderlint-setup skill describes.
- No placeholder leaks: format numbers and dates and handle \`null\` values so the UI never shows \`undefined\`, \`NaN\`, \`[object Object]\`, \`Invalid Date\` or lorem ipsum.

Warnings (\`fragile-layout\` = breaks with longer text, long words, bigger numbers or longer API data; small tap targets; tiny text…) don't fail the run, but fix them when it's cheap.

${wordpress ? wordpressNotes(cmd, wordpress) : ''}Commands: \`${cmd}\` (auto-detects the dev server or build output), \`${cmd} http://localhost:3000\`, \`${cmd} dist\`, \`${cmd} --pages /,/pricing\`, \`${cmd} --json\`.
${END}
`;
}

function skillsBlock(paths) {
  const what = {
    'renderlint-setup': 'making renderlint check every page: login, roles, API mocks, dynamic routes, and closing coverage gaps',
    'renderlint-fix': 'fixing what it reports, rule by rule',
    'renderlint-e2e': 'checking the states Playwright tests and Storybook stories reach; reusing MSW or HAR mocks',
  };
  return `6. Read the matching skill before that kind of work:\n${paths.map((p) => {
    const name = (p.match(/(renderlint-[a-z0-9]+)\/SKILL\.md$/) || [])[1];
    return `   - \`${p}\`: ${what[name] || name}`;
  }).join('\n')}\n`;
}

function wordpressNotes(cmd, wp) {
  return `**WordPress (this is a ${wp.kind})**
- PHP renders the pages, so renderlint checks the local site (the \`url\` in renderlint.config.json${wp.devCommand ? `, started with \`${wp.devCommand}\` when it isn't running` : ''}). The site must be running with this ${wp.kind} active. \`${cmd} --pages /,/shop/,/contact/\` checks specific pages; wp-admin, login, feeds and REST URLs are never crawled.
- Fix what lives in this repository: templates (PHP, block templates and patterns), \`theme.json\` and CSS. Elementor and block-editor content lives in the database: a finding there names the widget or block (\`Elementor heading 3f2a1b7 in page #12 — edit: …\`) and links to the editor. Fix it there, or with WP-CLI if you have it, and otherwise tell the user exactly what to change.
- Elementor: set font sizes and widths per device (Mobile/Tablet), avoid fixed px widths, and replace default widget texts ("Add Your Heading Text Here", "Click here"). Content hidden by an entrance animation that never runs (\`invisible-content\`) usually means Elementor's JavaScript is being delayed by an optimisation plugin.

`;
}

export function upsertSection(existing, section) {
  if (!existing) return section;
  const s = existing.indexOf(START), e = existing.indexOf(END);
  if (s !== -1 && e !== -1) return existing.slice(0, s) + section.trim() + existing.slice(e + END.length);
  return existing.replace(/\s*$/, '\n\n') + section;
}
