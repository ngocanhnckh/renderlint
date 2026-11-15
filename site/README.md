# renderlint.yitec.net

The website and blog for renderlint. It is a static site: `npm run build` writes plain HTML, CSS (inlined), images and feeds to `dist/`, with no client framework. The only JavaScript is a few lines for the copy buttons and the hero clip.

```bash
cd site
npm install
npm run build      # → dist/ (needs Playwright's Chromium from the repo root for the OG images)
npm run serve      # http://127.0.0.1:4380
```

## Where things are

| Path | What |
|---|---|
| `scripts/build.mjs` | The generator: pages, blog, rules (from `../src/rules-meta.js`), sitemap, feeds, `llms.txt`, JSON-LD, OG images |
| `scripts/pages/*.mjs` | Home, get started and examples page templates |
| `src/styles.css`, `src/main.js` | All CSS (inlined into each page) and the client script |
| `content/blog/*.md` | Articles: front matter (`title`, `description`, `slug`, `date`, `tags`, `rule`) + Markdown. Images as `captures/<pair>/<file>` or `docs/<file>` |
| `examples-src/` | Seven before/after example pages, each with one kind of defect and its fix |
| `content/captures/` | renderlint's real output on those pages (`npm run capture` regenerates it) |
| `video/hero/` | The HyperFrames composition for the hero clip (`npm run video` regenerates it) |
| `static/` | Copied as is: the rendered clip and poster, `_headers` |

## Regenerating the real output

- `npm run capture` runs renderlint (`../bin/renderlint.js`) on every page in `examples-src/` and stores the report text, the summary and the annotated screenshots in `content/captures/`. Nothing in there is edited by hand.
- `npm run video` re-runs renderlint on `examples-src/overflow-before.html`, measures the flagged elements, writes the HyperFrames composition (`video/hero/index.html`) and renders it. HyperFrames needs Node 22+: set `HYPERFRAMES_BIN` to the `hyperframes` CLI (`node_modules/hyperframes/dist/cli.js` of an install) and `HYPERFRAMES_NODE` to a Node 22 binary. `node scripts/render-video.mjs --compose-only` writes the composition without rendering.

## Checks before publishing

```bash
npm run build
node ../bin/renderlint.js dist     # must print "No UI defects found."
```

## Deploying

`dist/` can go on any static host. Set the build command to `cd site && npm ci && npm run build` and the output directory to `site/dist`. Cloudflare Pages and Netlify also read `dist/_headers` (cache rules). `404.html` is the not-found page on all of them.

DNS for `renderlint.yitec.net`: add a `CNAME` record for `renderlint` in the `yitec.net` zone pointing at the host's target (for example `<project>.pages.dev` on Cloudflare Pages, `<site>.netlify.app` on Netlify, `<user>.github.io` on GitHub Pages), then add the custom domain in the host's settings so it issues the TLS certificate. Canonical URLs, the sitemap, feeds and Open Graph tags already use `https://renderlint.yitec.net`.
