# Agent instructions (contributing to renderlint)

- Read CONTRIBUTING.md first. Rules run inside the page (`src/analyzer/`); keep them dependency-free browser JS.
- After changing `src/analyzer/**` or `src/client/**`, run `npm run build:client` (CI checks `dist/` is up to date).
- After changing `src/rules-meta.js`, run `node scripts/gen-docs.js`.
- `npm test` must pass. Every rule must fire on its defect fixture and stay silent on all clean fixtures. Avoid false positives above all.
