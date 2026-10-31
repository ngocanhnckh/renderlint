// (in an app: reporter: [['renderlint/playwright/reporter']])
// A real Playwright Test run with renderlint's fixture and reporter (driven by test/playwright.test.js).
// The app is test/fixtures/auth (a sessionStorage-token SPA); the tests mock its API with page.route,
// as many suites do, and sign in through the form.
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const port = +(process.env.RL_PW_PORT || 4391);
const out = process.env.RL_PW_OUT || fileURLToPath(new URL('../.tmp/pw', import.meta.url));
process.env.RL_PW_OUT = out; // for the specs

export default defineConfig({
  testDir: '.',
  workers: 2,
  reporter: [['line'], [fileURLToPath(new URL('../../src/integrations/playwright-reporter.js', import.meta.url)), { outputDir: out }]],
  outputDir: out + '/test-results',
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 800 } },
  webServer: { command: `node serve.mjs ${port}`, url: `http://127.0.0.1:${port}/login`, reuseExistingServer: false, timeout: 20000 },
});
