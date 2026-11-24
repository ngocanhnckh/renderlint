// Content from README.md (Quick start, Usage, What init does, Configuration) and docs/integrations.md.
export async function getStarted({ copyCmd, esc, crumbs, REPO, INSTALL, terminal }) {
  const code = (lang, s) => `<pre><code class="language-${lang}">${esc(s)}</code></pre>`;
  const D = (f) => `${REPO}/blob/master/docs/${f}`;
  return `<div class="page-head"><div class="wrap">${crumbs([['Home', '/'], ['Get started', '/get-started/']])}
<h1>Get started with renderlint</h1>
<p class="lede">One command sets it up: it installs renderlint, writes a config, gates your build, and tells your coding agent to run it after every UI change. You need Node.js 18.17 or newer.</p>
<div style="margin-top:28px">${copyCmd(INSTALL)}</div></div></div>
<div class="wrap article"><div class="prose">
<h2 id="agent">Set it up through your coding agent</h2>
<p>Paste this into Claude Code, Cursor, Codex, Copilot, Gemini CLI, Windsurf, Aider, Zed or Amp:</p>
<blockquote><p>Set up renderlint in this project: run <code>npx -y @yitec/renderlint init</code>, then follow the “UI quality gate: renderlint” section it adds to AGENTS.md: after every UI change run <code>npx renderlint</code> and fix every reported error until it shows 0 errors.</p></blockquote>

<h2 id="yourself">Or run it yourself</h2>
${code('bash', `npx -y @yitec/renderlint init   # one-time setup: config, build gate, agent instructions, Claude Code hook
npx renderlint                   # check: exits 1 if any error is found`)}
<p>Or just install it with <code>npm i -D @yitec/renderlint</code>. The command is <code>renderlint</code> either way. To try it once without installing: <code>npx -y @yitec/renderlint http://localhost:3000</code>.</p>

<h3 id="init">What does <code>init</code> do?</h3>
<ol>
<li>Adds renderlint as a dev dependency (creating a <code>package.json</code> for plain HTML sites).</li>
<li>Writes <code>renderlint.config.json</code>, pointed at your dev command or static folder.</li>
<li>Adds a <code>lint:ui</code> script and appends the check to <code>build</code>, so builds fail on UI defects (<code>--no-build</code> to skip).</li>
<li>Installs the agent skills <code>renderlint-setup</code>, <code>renderlint-fix</code> and <code>renderlint-e2e</code> in <code>.claude/skills/</code> (<code>--no-skills</code> to skip).</li>
<li>Adds the agent workflow to <code>AGENTS.md</code> and creates or updates <code>CLAUDE.md</code>.</li>
<li>Installs the Claude Code Stop hook in <code>.claude/settings.json</code> (<code>--no-hook</code> to skip).</li>
<li>Adds <code>.renderlint/</code> to <code>.gitignore</code> and makes sure a headless Chromium is available.</li>
</ol>
<p><code>init</code> is idempotent: run it again to update the skills it installed.</p>

<h2 id="usage">How do you point it at your app?</h2>
<p>Without config, <code>renderlint</code> works out what to check: a running dev server, then your <code>dev</code> script (started and stopped for you), then a build folder (<code>dist</code>, <code>build</code>, <code>out</code>…), then <code>index.html</code>. You can also give it a target:</p>
${code('bash', `npx renderlint http://localhost:3000            # any running app
npx renderlint dist                             # a static build (served for you)
npx renderlint index.html about.html            # plain files
npx renderlint --serve "npm run preview" --url http://localhost:4173
npx renderlint --pages /,/pricing,/dashboard --viewports 360,768,1440
npx renderlint --sweep 1024,1366                # only these extra widths (--no-sweep to skip)
npx renderlint --ux                             # also click through every page
npx renderlint explain contrast                 # what a rule means and how to fix it`)}
<p>Every run writes <code>.renderlint/report.json</code>, <code>.renderlint/report.md</code> and annotated screenshots to <code>.renderlint/screens/</code>. Output formats: plain text (default), <code>--json</code>, <code>--format md</code> and <code>--format github</code> for pull-request annotations.</p>

<h3 id="output">What does the output look like?</h3>
<pre class="term"><code>${terminal(`✖ contrast (3)  Text does not have enough contrast with what is actually behind it …
  error Low text contrast: 2.66:1, needs 4.5:1 — #ffffff on a non-uniform background (≈#459bf4).
        at #top > section.hero > div.hero-copy > a.pill > b  "New"
        in Hero — src/components/Hero.tsx:42
        page / · all viewports · see .renderlint/screens/index@375.png #3
       fix use text #2e2e2e (currently #ffffff on #459bf4)

✖ 4 error(s), 2 warning(s) · screenshots in .renderlint/screens`)}</code></pre>

<h2 id="build">How do you fail the build on UI defects?</h2>
<p><code>init</code> appends the check to your <code>build</code> script. By hand:</p>
<div class="table-wrap wide"><table><thead><tr><th scope="col">Framework</th><th scope="col"><code>build</code> script</th></tr></thead><tbody>
<tr><td>Vite (React, Vue, Svelte, Solid, Preact, Lit), Qwik</td><td><code>vite build &amp;&amp; renderlint dist</code></td></tr>
<tr><td>Next.js</td><td><code>next build &amp;&amp; renderlint --serve "npx next start -p 4319" --url http://localhost:4319</code></td></tr>
<tr><td>Next.js static export</td><td><code>next build &amp;&amp; renderlint out</code></td></tr>
<tr><td>SvelteKit</td><td><code>vite build &amp;&amp; renderlint --serve "npx vite preview --port 4319 --strictPort" --url http://localhost:4319</code></td></tr>
<tr><td>Astro</td><td><code>astro build &amp;&amp; renderlint dist</code></td></tr>
<tr><td>Nuxt</td><td><code>nuxt generate &amp;&amp; renderlint .output/public</code></td></tr>
<tr><td>Angular</td><td><code>ng build &amp;&amp; renderlint dist/&lt;project&gt;/browser</code></td></tr>
<tr><td>Eleventy, Hugo, Jekyll</td><td><code>renderlint _site</code> / <code>renderlint public</code></td></tr>
<tr><td>WordPress and Elementor</td><td>No build step: <code>renderlint</code> finds the local site (wp-env, LocalWP, DDEV, Lando, Docker Compose)</td></tr>
<tr><td>Rails, Django, Laravel, anything with a server</td><td><code>renderlint --serve "bin/rails s -p 4319" --url http://localhost:4319</code></td></tr>
</tbody></table></div>
<p>Framework guides: <a href="${D('frameworks/README.md')}">all frameworks</a>, <a href="${D('integrations.md')}">integrations</a>.</p>

<h2 id="claude">How do you make Claude Code check its own UI?</h2>
<p><code>init</code> registers a Stop hook in <code>.claude/settings.json</code>:</p>
${code('json', `{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "npx renderlint hook", "timeout": 600 }] }] } }`)}
<p>When Claude is about to finish a turn in which UI files changed, the hook runs renderlint on the routes the edit can affect. If errors remain, the report goes back to Claude (exit code 2) and it keeps working. It never blocks more than 4 times in a row, and does nothing when no UI file changed. Other agents get the same workflow through <code>AGENTS.md</code> and three <a href="${D('agents.md')}">skills</a>.</p>

<h2 id="ci">How do you run it in GitHub Actions?</h2>
${code('yaml', `name: UI lint
on: [pull_request]
jobs:
  renderlint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx renderlint dist --format github   # inline PR annotations; exits 1 on errors
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: renderlint, path: .renderlint }`)}

<h2 id="vite">How do you see findings while you code?</h2>
${code('ts', `// vite.config.ts
import renderlint from '@yitec/renderlint/vite';

export default defineConfig({
  plugins: [react(), renderlint()],
});`)}
<p>In <code>vite dev</code>, an overlay lists findings for the current viewport and links each to its component file and line. <code>vite build</code> fails on errors. In any other app: <code>import('@yitec/renderlint/client').then((m) =&gt; m.start())</code>.</p>

<h2 id="config">How do you configure it?</h2>
<p><code>renderlint.config.json</code> (or <code>.js</code>/<code>.mjs</code>, or a <code>"renderlint"</code> key in <code>package.json</code>):</p>
${code('json', `{
  "serve": "npm run dev",
  "pages": ["/", "/pricing"],
  "viewports": [375, 768, 1280],
  "colorSchemes": "auto",
  "rules": { "line-length": "off", "tap-target": "error" },
  "ignore": [{ "rule": "contrast", "selector": ".legal-footnote" }],
  "states": [{ "name": "account menu", "click": "[aria-label=Account]", "waitFor": "[role=menu]" }],
  "mock": { "**/api/notifications*": [] }
}`)}
<p>All options: <a href="${D('configuration.md')}">configuration</a>. Pages behind a login: <a href="${D('authentication.md')}">authentication</a> and <a href="${D('roles-and-coverage.md')}">roles and coverage</a>. Playwright: <a href="${D('playwright.md')}">withRenderlint</a>. Storybook: <a href="${D('storybook.md')}">renderlint storybook</a>.</p>

<h2 id="limits">What are the limits?</h2>
<ul>
<li>Labels inside <code>&lt;canvas&gt;</code> charts (Chart.js, ECharts in canvas mode) are pixels and can’t be inspected. SVG charts are checked.</li>
<li>Pages are checked as they load, with each menu opened. Other states behind clicks are linted when you list them in <code>states</code> or reach them in a Playwright test; <code>--ux</code> judges the clicks themselves.</li>
<li>Server mocks are Node only. Pages a Django, Rails, Laravel or Go server renders need a running backend with test accounts.</li>
<li>Contrast follows WCAG 2 AA math, not APCA.</li>
<li>A single page takes about 4–10 seconds at three viewports with the sweep and stress passes. Use <code>--sweep 1024</code> or <code>--no-sweep</code> for a faster inner loop.</li>
</ul>
</div>
<nav class="toc" aria-labelledby="toc-h"><h2 id="toc-h">On this page</h2><ol>
<li><a href="#agent">Through your coding agent</a></li><li><a href="#yourself">Run it yourself</a></li><li><a href="#usage">Point it at your app</a></li><li><a href="#build">Fail the build</a></li><li><a href="#claude">Claude Code hook</a></li><li><a href="#ci">GitHub Actions</a></li><li><a href="#vite">Vite overlay</a></li><li><a href="#config">Configuration</a></li><li><a href="#limits">Limits</a></li></ol></nav>
</div><div style="height:clamp(48px,7vw,96px)"></div>`;
}
