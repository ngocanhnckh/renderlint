---
name: renderlint-e2e
description: Connect renderlint to the test setups this project already has, so every state they reach gets checked. Covers the Playwright Test fixture and reporter (states reached by clicks, dialogs, multi-step flows, each role a test signs in as), Storybook stories, and reusing MSW handlers or a HAR recording as renderlint's API data. Use when the project has Playwright tests, a Storybook, or MSW mocks.
---

# Reuse the project's tests, stories and mocks

The CLI crawls pages. Some states only exist after clicks: a dialog, step 3 of a wizard, a filled form, a menu. A project's end-to-end tests and stories already reach those states. Let renderlint check them where they are.

## Playwright Test

1. Wrap the project's `test`, once, in a fixtures file:

   ```ts
   // tests/fixtures.ts
   import { test as base } from '@playwright/test';
   import { withRenderlint } from '@ngocanhnckh/renderlint/playwright';
   export const test = withRenderlint(base);
   export { expect } from '@playwright/test';
   ```

   Then change the specs to `import { test, expect } from './fixtures'`. If they already import a custom fixture file, extend that one instead: `withRenderlint(existingTest)`.

2. Add the reporter, which merges every worker's findings into one report and fails the run on errors:

   ```ts
   // playwright.config.ts
   reporter: [['list'], ['@ngocanhnckh/renderlint/playwright/reporter']],
   ```

3. Run the suite as usual: `npx playwright test`. The report goes to `.renderlint/` like a CLI run.

What gets checked:
- **At the end of every passing test,** the page as the test left it (dialog open, wizard step 2), at every viewport and in dark mode. The page is put back exactly as it was afterwards.
- **Every URL a test visited** is re-opened at the end of the worker with the test's cookies, storage and API responses, and checked like the CLI does (touch on phones, data stress).
- **Mid-test,** where a state matters: `test('…', async ({ page, renderlint }) => { …; await renderlint('review dialog'); })`.

Options go in `withRenderlint(base, { … })` or `test.use({ renderlintOptions: { … } })`:
- `role`: name in the report; defaults to the project name, so one project per role works out of the box.
- `auto: 'visits' | 'end' | false`.
- `failTests`: also fail the test itself; the default only fails the run.
- any renderlint config key: `viewports`, `rules`, `ignore`.

Tests keep their own result unless `failTests: true`. Pages on other origins (payment, identity provider) are not checked.

## Storybook

```bash
npx storybook build && npx renderlint storybook                 # storybook-static/
npx renderlint storybook http://localhost:6006                   # a running Storybook
npx renderlint storybook --globals theme:dark --stories "Forms/*"
```

- Every story in `index.json` (Storybook 7+) is checked in its own iframe, after its play function finishes.
- Tag a story `skip-renderlint` to leave it out.
- Component stories (`padded` or `centered` layout) skip page-level rules such as `viewport-overflow`.
- Add stories with worst-case args (long names, empty lists) so they get checked too.

## Reuse API mocks the project already has

```json
{ "mockFrom": ["src/mocks/handlers.ts"] }
```

- **MSW 2.x handler files:** TypeScript is compiled with the project's esbuild.
- **HAR recordings:** record once against a real backend (`page.routeFromHAR` or the browser's DevTools), then replay `"mockFrom": ["recordings/app.har"]`.
- **Explicit `mock` entries win** over both.
- **Uncovered requests:** with `mockFrom`, a request none of them answers that then fails is a `broken-resource` warning. Add it to the handlers rather than ignoring it.

Details: [docs/playwright.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/playwright.md), [docs/storybook.md](https://gitlab.com/anhnn.a05/renderlint/-/blob/master/docs/storybook.md).
