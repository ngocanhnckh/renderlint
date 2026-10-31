# Integrations

renderlint works on anything that renders in a browser. Pick the gate that suits you; you can combine them.

## Any framework: fail the build

`renderlint init` appends the check to your `build` script. To do it by hand:

| Framework | `build` script |
|---|---|
| Vite (React/Vue/Svelte/Solid/Preact/Lit), CRA, Vue CLI, Parcel, Qwik | `vite build && renderlint dist` (or `build/`) |
| Next.js | `next build && renderlint --serve "npx next start -p 4319" --url http://localhost:4319` |
| Next.js static export | `next build && renderlint out` |
| SvelteKit | `vite build && renderlint --serve "npx vite preview --port 4319 --strictPort" --url http://localhost:4319` |
| Astro | `astro build && renderlint dist` (static) or `--serve "npx astro preview --port 4319"` |
| Nuxt | `nuxt build && renderlint --serve "npx nuxi preview --port 4319" --url http://localhost:4319` (or `nuxt generate && renderlint .output/public`) |
| Angular | `ng build && renderlint dist/<project>/browser` |
| Gatsby | `gatsby build && renderlint public` |
| Eleventy / Hugo / Jekyll | `renderlint _site` / `renderlint public` |
| Plain HTML | `renderlint .` or `renderlint index.html` |
| WordPress (themes, plugins, Elementor) | no build step: `renderlint` checks the local site (wp-env, LocalWP, DDEV…). See [wordpress.md](wordpress.md) |
| Rails / Django / Laravel / PHP / anything with a server | `renderlint --serve "bin/rails s -p 4319" --url http://localhost:4319` |

## Vite plugin

```ts
// vite.config.ts
import renderlint from '@ngocanhnckh/renderlint/vite';

export default defineConfig({
  plugins: [react(), renderlint({ /* rules, viewports, pages, build: true, overlay: true */ })],
});
```

- **`vite dev`**: a small overlay in the corner lists findings for the current viewport (hover one to highlight the element), and they are printed in the dev-server terminal with `file:line`:
  ```
  [vite] [renderlint] 3 error(s), 1 warning(s) on / @1280px
    ✖ contrast: Low contrast: 3.50:1 (needs 4.5:1) — #898781 on #fcfcfb.
        at aside > nav > p.mb-2 (/src/components/Sidebar.tsx:172)
  ```
  In-browser contrast uses the DOM background chain (fast). The CLI measures real pixels.
- **`vite build`**: renders `dist/` in all viewports and throws (build fails) when error-level defects are found. Set `RENDERLINT_SKIP=1` to bypass once.
- Works for SPA builds (an `index.html` in `outDir`). For SSR frameworks use the CLI against a preview server (table above).

## Live overlay in any app

```js
// e.g. in a Next.js client component, Nuxt plugin, or main.ts — dev only
if (process.env.NODE_ENV === 'development') import('@ngocanhnckh/renderlint/client').then((m) => m.start());
```

## Claude Code

`renderlint init` registers a Stop hook in `.claude/settings.json`:

```json
{ "hooks": { "Stop": [{ "hooks": [{ "type": "command", "command": "npx renderlint hook", "timeout": 600 }] }] } }
```

When Claude is about to finish a turn in which UI files changed, the hook runs renderlint. If errors remain, the report is fed back to Claude (exit code 2) and it keeps working. It never blocks more than 4 times in a row and does nothing when no UI file changed.

## Other agents (Codex, Cursor, Copilot, Gemini CLI, Windsurf, Aider, Amp, Zed…)

`init` writes a "UI quality gate: renderlint" section to `AGENTS.md`, telling the agent to run `npx renderlint` after UI changes and fix every error, plus guidance on avoiding the defects in the first place. If your agent reads a different file (e.g. `.cursorrules`, `.github/copilot-instructions.md`, `GEMINI.md`), copy the section there or reference `AGENTS.md`.

## GitHub Actions

```yaml
name: UI lint
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
        with: { name: renderlint, path: .renderlint }
```

## Watch mode

```bash
npx renderlint watch            # re-checks (all viewports, pixel contrast) whenever src/ changes
```
