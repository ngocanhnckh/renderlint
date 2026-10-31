# Playwright Test

Your end-to-end tests already sign in as each role, click through dialogs and multi-step flows, and mock or seed the API. renderlint can check every state they reach, in the test's own browser page. That covers states no crawler finds: a review dialog, step 3 of a wizard, a menu opened by a button.

## Set up

```ts
// tests/fixtures.ts
import { test as base } from '@playwright/test';
import { withRenderlint } from '@ngocanhnckh/renderlint/playwright';
export const test = withRenderlint(base);
export { expect } from '@playwright/test';
```

Import `test` from `./fixtures` in your specs. If they already use a custom fixture file, wrap that one instead: `withRenderlint(myTest)`.

```ts
// playwright.config.ts
reporter: [['list'], ['@ngocanhnckh/renderlint/playwright/reporter']],
```

Run your suite as usual (`npx playwright test`). The reporter merges every worker's findings into one renderlint report: `.renderlint/report.json`, `report.md` and screenshots. It prints the report after the run and fails the run on errors (`failOn`).

The module never imports `@playwright/test` itself; it extends the `test` you pass, so it always uses your project's copy.

## What gets checked

- **At the end of every passing test:** the page as the test left it, in place.
  - It checks each viewport by resizing the page, and dark mode by emulation, including the stress and sweep passes.
  - Then it restores the page: size, colour scheme, scroll, text and focus.
  - States identical to one already checked (ten tests ending on the dashboard) are checked once per run, across workers.
- **Every URL a test visited:** re-opened at the end of the worker in fresh contexts.
  - It uses the test's cookies, localStorage, sessionStorage, and the JSON responses the test received, from your backend or your own `page.route` mocks.
  - Each URL is then checked like the CLI does: real viewport contexts, touch on phones, and the data stress.
  - A URL that lands somewhere else (state that only lived in memory, a role guard) is skipped with a note, never reported as clean.
- **Mid-test, on request:**

  ```ts
  test('review', async ({ page, renderlint }) => {
    await page.getByRole('button', { name: 'Write a review' }).click();
    await renderlint('review dialog');
    // …the test continues as before
  });
  ```

  Without the fixture: `import { renderlint } from '@ngocanhnckh/renderlint/playwright'; await renderlint(page, 'review dialog')`.

## Options

`withRenderlint(base, { … })`, or per file or project: `test.use({ renderlintOptions: { … } })`.

| Option | Default | |
|---|---|---|
| `auto` | `'visits'` | `'visits'`: end-of-test check plus replay of every visited URL. `'end'`: end-of-test check only. `false`: only explicit `renderlint()` calls. |
| `role` | the project name | Name in the report, and what identical states are grouped by. One Playwright project per role works out of the box. |
| `failTests` | `false` | Also fail the test itself on errors. By default tests keep their result and the reporter fails the run. |
| `checkFailed` | `false` | Also check the end state of failed tests. |
| `replayMocks` | `true` | Replay the JSON responses the test received when re-opening visited URLs. |
| any renderlint key | | `viewports`, `rules`, `ignore`, `stress`, `sweep`… `renderlint.config.*` is read too. |

## Limits

- **Other origins aren't checked:** pages outside `baseURL`, such as a payment page or an identity provider.
- **Each in-place check adds a couple of seconds** (3 viewports, stress and sweep). The fixture extends the test's timeout by up to two minutes for it.
- **Resizing in place can change state:** an app that reacts to resize, by closing a menu on a breakpoint change for example, may end up different after the check. If a test relies on state after a check, set `auto: false` and call `renderlint()` at the points where the state is stable, or at the end.
- **Replays send the test's GET responses again.** Other requests, POSTs included, go to the real server.
- **Tested with:** Chromium and a React app with two roles. Firefox, WebKit and Cypress are not supported yet.
