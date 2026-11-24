import { PAIRS, capture, excerpt } from './pairs.mjs';

// Every fact here is from README.md, docs/results.md or CHANGELOG.md.
export const FAQ = [
  { q: 'What is renderlint?', a: 'renderlint is an open-source (MIT) linter for the rendered UI. It opens a web app in headless Chromium at phone, tablet and desktop widths, finds visual defects such as text overflowing its box, low contrast, overlapping elements, unreachable content and menus that can’t be seen, and exits with code 1 until they are fixed. Each finding names the element, the source file, an annotated screenshot and a fix.' },
  { q: 'How is it different from ESLint, axe or Lighthouse?', a: 'ESLint, stylelint and TypeScript read source code, so they can’t see that text spills out of a card. axe-core and Lighthouse read the DOM and computed CSS, so they don’t catch overflow, overlap or clipping, and they report contrast over gradients and images as “needs review”. renderlint measures the rendered geometry and the real pixels behind each glyph.' },
  { q: 'Is it a visual regression testing tool?', a: 'No. Visual regression tools (Percy, Chromatic, BackstopJS, Playwright screenshots) compare pixels against approved images, so a defect in the first version becomes the baseline, and they show what changed rather than what is wrong. renderlint needs no baseline: it judges each page on its own. Use visual regression for unintended changes to an approved design, and renderlint for defects in pages nobody has approved yet.' },
  { q: 'Which frameworks does it support?', a: 'Anything that renders in a browser: React, Next.js, Vue, Nuxt, Svelte and SvelteKit, Astro, Angular, Solid, Qwik, Remix, WordPress and plain HTML. It reads routes from the source of Next.js, Nuxt, SvelteKit, Astro, React Router / Remix, TanStack Router, Angular and Vue Router apps.' },
  { q: 'Can it check pages behind a login?', a: 'Yes. Give it the token your route guard reads and mock the API, log in once through your real form, or run a script for SSO. With roles, every page is checked as each role. A page that only showed the login form or “Access denied” is reported as auth-required or page-not-shown, never passed.' },
  { q: 'How do I use it with Claude Code and other coding agents?', a: 'Run npx -y @yitec/renderlint init. It adds a Claude Code Stop hook, so Claude can’t end its turn while UI errors remain in files it changed (it gives up after 4 attempts), writes the workflow into AGENTS.md for Codex, Cursor, Copilot, Gemini CLI and others, and installs three skills for setup, fixing and Playwright/Storybook.' },
  { q: 'How long does a check take?', a: 'A single page takes about 4 to 10 seconds at three viewports with the sweep and stress passes. Pages are checked side by side, and pages that render identically share their checks. Use --sweep 1024 or --no-sweep for a faster inner loop.' },
  { q: 'Has renderlint found bugs in real open-source projects?', a: 'Yes. Scans of popular documentation sites found layout bugs in Ant Design, Mantine, Nuxt UI and Panda CSS, four projects with more than 145,000 GitHub stars between them. Each fix was one to seven lines of CSS, and all four pull requests were merged in November 2026.' },
  { q: 'What can’t it check?', a: 'Labels inside <canvas> charts are pixels, so they can’t be inspected. What sits behind clicks (dialogs, tabs, filled forms) is only linted when you list it in states or reach it in a Playwright test. Contrast follows the WCAG 2 AA formula, not APCA. Server mocks are Node only.' },
];

function pairCard(p, { img, terminal, esc }, { compact = false, h = 'h3' } = {}) {
  const before = capture(p.id, 'before.txt');
  const sizes = '(max-width: 720px) 100vw, 560px';
  return (async () => `<article class="pair" id="${p.id}">
<div class="pair-head"><${h}>${p.title}</${h}><p>${p.rules.map((r) => `<a href="/rules/#${r}"><code>${r}</code></a>`).join(' ')}</p></div>
<div class="pair-body">
${p.noShot
    ? `<figure class="shot"><pre class="term" style="margin:0;flex:1"><code>${terminal(excerpt(before, 2))}</code></pre><figcaption><span class="tag bad">Before</span> renderlint’s report (a native dialog can’t be screenshotted)</figcaption></figure>`
    : `<figure class="shot"><div class="frame">${await img(`captures/${p.id}/${p.shot || 'before.png'}`, p.beforeAlt, { sizes })}</div><figcaption><span class="tag bad">Before</span> renderlint’s annotated screenshot</figcaption></figure>`}
<figure class="shot"><div class="frame">${await img(`captures/${p.id}/after.png`, p.afterAlt, { sizes })}</div><figcaption><span class="tag good">After</span> 0 errors</figcaption></figure>
</div>
<div class="pair-foot"><p style="margin:0 0 14px">${p.lead}</p>${compact ? '' : `<p style="margin:0 0 14px"><b>Fix:</b> ${p.fix}</p>`}</div>
${p.noShot ? '' : `<pre class="term"><code>${terminal(excerpt(before, compact ? 2 : 3))}</code></pre>`}
<div class="pair-foot"><a class="link-arrow" href="/blog/${p.post}/">Read how to find and fix it</a></div>
</article>`)();
}
export { pairCard };

export async function home(c) {
  const { posts, postCard, copyCmd, ICON, WORKS_WITH, MERGED_IN, MERGED_POST, img, esc, terminal, RULES, VERSION, REPO, INSTALL } = c;
  const n = Object.keys(RULES).length;
  const featured = [];
  for (const id of ['overflow', 'menu', 'unreachable', 'contrast']) featured.push(await pairCard(PAIRS.find((p) => p.id === id), c, { compact: true }));
  const catches = [
    ['Longer text pokes out of a card, button or badge, or runs right up to its border', 'text-overflow, text-clipped, text-crowding'],
    ['A layout that fits today’s sample copy but breaks with real data', 'fragile-layout'],
    ['Gray-on-gray or white-on-yellow text you can barely read (measured from real pixels, so it works on gradients and images)', 'contrast'],
    ['Elements overlap when the window shrinks, instead of wrapping', 'element-overlap, viewport-overflow, content-overflow'],
    ['Chart and diagram labels collide or get cut off (SVG charts)', 'text-overlap, text-clipped'],
    ['A page or tab you can’t scroll: an <code>overflow: hidden</code> app shell, a fixed-height card hiding its list, a scroll lock left on', 'unreachable-content'],
    ['A fixed header covers the hero, or a decoration covers a button', 'obscured-content'],
    ['A dropdown that opens behind the next card, or is cut off by its card or a table’s scroll box', 'popup-obscured'],
    ['Emoji used as icons instead of a proper icon set', 'emoji'],
    ['<code>undefined</code>, <code>NaN</code>, <code>[object Object]</code>, <code>Invalid Date</code>, lorem ipsum', 'placeholder-text'],
    ['Broken or stretched images, giant unsized SVG icons', 'broken-image, image-distortion, oversized-icon'],
    ['A dropdown arrow on the border, a checkbox floating above its label, an icon over the placeholder, a squashed input', 'dropdown-arrow, checkbox-layout, input-icon-overlap, squashed-control'],
    ['<code>alert()</code> and <code>confirm()</code>: the browser’s grey system box instead of the app’s own toast or modal', 'native-dialog'],
    ['A card that stays blank while its data loads, then pops in; content that jumps when it arrives', 'loading-state, layout-shift'],
    ['With <code>--ux</code>: a click with no feedback for a second, a failed save nobody is told about, a double submit, a dead button, a freeze', 'action-feedback, error-feedback, double-submit, dead-control, ui-freeze'],
    ['No viewport meta, a pointless 3px scrollbar, <code>href="#"</code> links, no focus ring, tiny tap targets', 'missing-viewport-meta, accidental-scrollbar, dead-link, focus-indicator, tap-target'],
    ['Hydration errors, crashes, 404s, pages that only showed the login form or “Access denied”', 'console-error, page-error, broken-resource, auth-required, page-not-shown'],
  ];
  const ignore = (w) => w.includes('lorem ipsum') ? ' data-renderlint-ignore="placeholder-text" data-renderlint-reason="names the placeholders the rule catches"' : '';
  const ruleLinks = (s) => s.split(', ').map((r) => `<a href="/rules/#${r}"><code>${r}</code></a>`).join(' ');
  return `
<section class="hero" aria-labelledby="h1">
<div class="wrap">
<div>
<div class="eyebrow"><span class="dot">${ICON.box}</span><div><b>Open source, MIT</b><span>Version ${VERSION} · <a href="${REPO}/blob/master/CHANGELOG.md">Read the changelog</a></span></div></div>
<h1 id="h1">A linter for the rendered UI</h1>
<p class="lede">renderlint opens your app in a real browser, finds the visual defects coding agents ship, and fails the build until they’re fixed. TypeScript and ESLint can’t see these bugs, because the code is fine. It’s the pixels that are wrong.</p>
<div class="proof"><span class="n">229 → 0</span><span>errors across 22 Claude Code sessions: 11 apps without renderlint, 11 with it</span></div>
<div class="actions">${copyCmd(INSTALL)}<a class="link-arrow" href="${REPO}">Star on GitHub ${ICON.arrow}</a></div>
</div>
<div class="hero-media">
<div class="clipcard" data-clip data-poster="/media/hero-poster.webp" data-webm="/media/hero.webm" data-mp4="/media/hero.mp4">
<img src="/media/hero-poster.webp" width="720" height="810" alt="renderlint’s check of a billing page at 375px: four elements boxed in red (an email and a button label spilling out of their card, two KPI values cut off), next to a terminal reporting 5 errors" fetchpriority="high">
<button class="play" type="button" hidden>Play animation</button>
</div>
<div class="float f1" aria-hidden="true"><small>— Checks</small><b>${n}</b><span>rules on the rendered page</span></div>
</div>
</div>
</section>

<section class="wrap logos" aria-labelledby="works-h">
<p id="works-h">Works with anything that renders in a browser, including</p>
${WORKS_WITH}
</section>

<section class="wrap logos merged" aria-labelledby="merged-h">
<p id="merged-h">Bugs renderlint found, now fixed upstream in</p>
${MERGED_IN}
<p class="merged-more"><a class="link-arrow" href="${MERGED_POST}">How renderlint found them, and the fixes ${ICON.arrow}</a></p>
</section>

<section class="wrap section" aria-labelledby="what-h">
<div class="define">
<div><span class="kicker">What it is</span><h2 id="what-h" style="margin-bottom:24px">What is renderlint?</h2>
<p class="answer">renderlint is a command-line linter that renders every page of a web app in headless Chromium, measures what is actually drawn, and reports visual defects with the element, the source file, an annotated screenshot and a concrete fix, in plain text a coding agent can act on.</p></div>
<dl class="facts">
<div><dt>${n}</dt><dd>rules, tuned so that a finding is almost always a real defect</dd></div>
<div><dt>3 + 13</dt><dd>viewports (375, 768, 1280px) plus a sweep of 13 widths from 320 to 1920px</dd></div>
<div><dt>0</dt><dd>baseline images to approve: each page is judged on its own</dd></div>
<div><dt>+50%</dt><dd>longer text, plus long words and bigger numbers, to catch layouts that break with real data</dd></div>
</dl>
</div>
</section>

<section class="wrap section" aria-labelledby="ba-h">
<div class="section-head"><div><span class="kicker">Before and after</span><h2 id="ba-h">Real bugs, real output, real fixes</h2></div>
<p>Each “before” is renderlint’s own annotated screenshot and report from a run on that page. Each “after” is the same page with the fix from the report applied, at 0 errors. Nothing here is mocked up.</p></div>
<div class="grid-2">${featured.join('')}</div>
<p style="margin-top:28px"><a class="btn ghost" href="/examples/">See all examples</a></p>
</section>

<section class="wrap section" aria-labelledby="catch-h">
<div class="section-head"><div><span class="kicker">Coverage</span><h2 id="catch-h">What does renderlint catch?</h2></div>
<p>Defects that pass type checks, linters and code review, because the code is valid. It is the rendering that is wrong, often only at one width or with longer content than the sample data.</p></div>
<div class="table-wrap"><table><thead><tr><th scope="col">What you see</th><th scope="col">renderlint rule</th></tr></thead><tbody>
${catches.map(([w, r]) => `<tr><td${ignore(w)}>${w}</td><td>${ruleLinks(r)}</td></tr>`).join('\n')}
</tbody></table></div>
<p><a class="link-arrow" href="/rules/">All ${n} rules with their fixes ${ICON.arrow}</a></p>
</section>

<section class="wrap section" aria-labelledby="how-h">
<div class="section-head"><div><span class="kicker">Method</span><h2 id="how-h">How does it work?</h2></div>
<p>Static analysis can’t know that a German heading is wider than its card at 1024px. renderlint renders the page and measures it.</p></div>
<ol class="steps">
<li><h3>Render</h3><p>Each page loads in headless Chromium at each viewport, and in dark mode if your CSS has one. Lazy content and scroll-reveal animations are triggered, fonts and images awaited.</p></li>
<li><h3>Measure</h3><p>An analyzer in the page compares the rect of every text run with its containers and clip boxes, checks intersections and hit-tests for what covers what.</p></li>
<li><h3>Look at the pixels</h3><p>For contrast, the page is captured twice, once with text made transparent, to get the real background behind each glyph: gradients, images, overlays.</p></li>
<li><h3>Stress</h3><p>The layout rules run again at the sweep widths, then with longer text, long words, bigger numbers and longer API data.</p></li>
<li><h3>Report</h3><p>Findings are merged across viewports and pages, mapped to a component or file, and given a fix hint and a numbered screenshot.</p></li>
</ol>
</section>

<section class="wrap section" aria-labelledby="works-h2">
<div class="section-head"><div><span class="kicker">Evidence</span><h2 id="works-h2">Does it work?</h2></div>
<p>22 headless Claude Code sessions (Opus and Haiku) each built a typical frontend in HTML, React, Next.js, Vue or Svelte. Half also got the one-line renderlint setup prompt.</p></div>
<div class="results">
<div class="big">
<div><b>229</b><span>errors in the 11 baseline apps, mostly WCAG contrast failures, plus emoji icons and clipped chart labels</span></div>
<div><b>0</b><span>errors in the 11 apps built with renderlint: the agents fixed the issues themselves</span></div>
<div class="wide"><b>13/13 · 12/12</b><span>missing loading states caught on a 75-page benchmark, including 24 pages written blind by a separate agent, with no false alarms</span></div>
</div>
<figure>${await img('docs/compare-weather.png', 'The same weather-app prompt in two Claude Code sessions: on the left, without renderlint, 42 contrast errors boxed; on the right, the session that ran renderlint and fixed its findings', { sizes: '(max-width: 900px) 100vw, 640px' })}
<figcaption>The same weather-app prompt in two sessions. Left: no renderlint, 42 errors. Right: the session that ran renderlint and fixed its own findings. Details in <a href="${REPO}/blob/master/docs/results.md">docs/results.md</a>.</figcaption></figure>
</div>
</section>

<section class="wrap section" aria-labelledby="cmp-h">
<div class="section-head"><div><span class="kicker">Comparison</span><h2 id="cmp-h">How does it compare with other tools?</h2></div>
<p>renderlint doesn’t replace your other tools. It covers the gap between “the code is valid” and “the page looks right”.</p></div>
<div class="table-wrap wide"><table class="compare"><thead><tr><th scope="col">Tool</th><th scope="col">Reads</th><th scope="col">Overflow, overlap, clipping</th><th scope="col">Contrast on gradients and images</th><th scope="col">Needs a baseline</th><th scope="col">Tells you the fix</th></tr></thead><tbody>
<tr><td>ESLint, stylelint, TypeScript</td><td>Source code</td><td>No</td><td>No</td><td>No</td><td>Yes, for code issues</td></tr>
<tr><td>axe-core, Lighthouse</td><td>DOM and computed CSS</td><td>No</td><td>Reported as “needs review”</td><td>No</td><td>Yes, for accessibility rules</td></tr>
<tr><td>Visual regression (Percy, Chromatic, BackstopJS, Playwright screenshots)</td><td>Pixels, against approved images</td><td>Only as a diff from the baseline</td><td>Only as a diff</td><td>Yes: a defect in the first version becomes the baseline</td><td>No: shows what changed, not what’s wrong</td></tr>
<tr class="us"><td>renderlint</td><td>Rendered geometry and pixels</td><td>Yes, at every width and with stressed content</td><td>Yes, from the real pixels behind each glyph</td><td>No</td><td>Yes: element, source file, screenshot and fix</td></tr>
</tbody></table></div>
<p class="scroll-hint">Swipe the table sideways to see every column.</p>
<p><a class="link-arrow" href="/blog/visual-regression-testing-vs-rendered-ui-linting/">Visual regression testing vs rendered-UI linting ${ICON.arrow}</a></p>
</section>

<section class="wrap section" aria-labelledby="gate-h">
<div class="section-head"><div><span class="kicker">Gates</span><h2 id="gate-h">Make it impossible to ship defects</h2></div>
<p>renderlint exits non-zero when it finds errors, so you can gate any step on it. <code>init</code> sets up the first three for you.</p></div>
<div class="gates">
<div class="gate"><h3>Any build</h3><p>Append the check to your build script, for any framework.</p><pre><code>"build": "vite build &amp;&amp; renderlint dist"</code></pre></div>
<div class="gate"><h3>Claude Code</h3><p>A Stop hook: Claude can’t end its turn while UI errors remain in files it changed. It gives up after 4 attempts.</p><pre><code>npx renderlint hook</code></pre></div>
<div class="gate"><h3>Other agents</h3><p>The workflow goes into <code>AGENTS.md</code>, read by Codex, Cursor, Copilot, Gemini CLI, Amp and Zed, plus three skills.</p><pre><code>npx -y @yitec/renderlint init</code></pre></div>
<div class="gate"><h3>Vite</h3><p>A live overlay in dev with source file and line; <code>vite build</code> fails on errors.</p><pre><code>import renderlint from '@yitec/renderlint/vite'</code></pre></div>
<div class="gate"><h3>CI</h3><p>Inline annotations on pull requests in GitHub Actions.</p><pre><code>npx renderlint dist --format github</code></pre></div>
<div class="gate"><h3>Playwright and Storybook</h3><p>Check every state your e2e tests reach, or every story.</p><pre><code>export const test = withRenderlint(base)</code></pre></div>
</div>
</section>

<section class="wrap section" aria-labelledby="faq-h">
<div class="section-head"><div><span class="kicker">FAQ</span><h2 id="faq-h">Frequently asked questions</h2></div><p>Short answers. The <a href="${REPO}#readme">README</a> and <a href="${REPO}/tree/master/docs">docs</a> have the details.</p></div>
<div class="faq">${FAQ.map((f) => `<div><h3>${esc(f.q)}</h3><p>${esc(f.a)}</p></div>`).join('')}</div>
</section>

<section class="wrap section" aria-labelledby="blog-h">
<div class="section-head"><div><span class="kicker">Blog</span><h2 id="blog-h">Guides to the bugs it catches</h2></div><p>How each defect happens in the browser, how to fix it, and how to catch it before it ships.</p></div>
<div class="posts">${posts.slice(0, 4).map((p) => postCard(p, 'h3')).join('')}</div>
<p style="margin-top:24px"><a class="btn ghost" href="/blog/">All articles</a></p>
</section>

<section class="cta" aria-labelledby="cta-h2"><div class="wrap">
<div><h2 id="cta-h2">Paste one line into your coding agent</h2><p>“Set up renderlint in this project: run <code>npx -y @yitec/renderlint init</code>, then follow the ‘UI quality gate: renderlint’ section it adds to AGENTS.md: after every UI change run <code>npx renderlint</code> and fix every reported error until it shows 0 errors.”</p></div>
<div class="stack">${copyCmd(INSTALL)}<div style="display:flex;flex-wrap:wrap;gap:12px"><a class="btn" href="/get-started/">Get started</a><a class="btn ghost" href="${REPO}">View on GitHub</a></div></div>
</div></section>
<div style="height:8px"></div>
`;
}
