# Contributing

Thanks for helping make AI-built UIs less broken.

## Layout

- `src/analyzer/` runs **inside the page**. `core.js` has the shared helpers (visibility, clip boxes, colors, selectors, source mapping), and `rules/*.js` has the rules. `bundle.js` concatenates them into one script.
- `src/runner.js` drives Playwright: settle the page, run the analyzer, take contrast screenshots (`src/contrast.js`), focus checks, the stress pass, and annotated screenshots.
- `src/report.js` merges and groups findings and formats them. `src/rules-meta.js` is the rule catalogue (severity, summary, fix text) used by the docs and the CLI.
- `src/integrations/vite.js`, `src/client/overlay.js` (dev overlay, built into `dist/client.js`), `src/init.js`, `src/hook.js`.

## Adding or changing a rule

1. Add a defect fixture `test/fixtures/defects/<name>.html` with `<meta name="expect" content="<rule>">`.
2. Implement the rule in `src/analyzer/rules/` and add its entry to `src/rules-meta.js`.
3. Make sure **every clean fixture still passes**. False positives are the worst failure mode for a linter that agents must obey. When a pattern is usually intentional, skip it in the rule and add it to `test/fixtures/clean/patterns.html`.
4. Run `npm run build:client` and `node scripts/gen-docs.js`, then `npm test`.
5. Touching anything WordPress-specific (crawl rules, Elementor mapping, `invisible-content`)? Also run `npm run test:wordpress`. It needs Docker: it starts WordPress with Elementor (`e2e/wordpress/`, port 8099, or set `RL_WP_PORT`), builds a well-made and a broken Elementor page, and checks both.
