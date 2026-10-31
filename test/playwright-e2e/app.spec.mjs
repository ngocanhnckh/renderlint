import { test as base, expect } from '@playwright/test';
import { withRenderlint } from 'renderlint/playwright';

const test = withRenderlint(base, { outputDir: process.env.RL_PW_OUT || 'test/.tmp/pw', viewports: [375, 1280], sweep: false, colorSchemes: ['light'] });

// The suite's own API mocks: renderlint's replays get the responses these produced.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/login', (r) => r.fulfill({ json: { token: 'tok' } }));
  await page.route('**/api/me', (r) => r.fulfill({ json: { name: 'Dana' } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: [{ title: 'Q3 revenue' }, { title: 'Churn by plan' }] }));
});

async function signIn(page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill('dana@example.com');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back, Dana' })).toBeVisible();
}

test('sign in lands on the dashboard', async ({ page }) => {
  await signIn(page);
});

test('reports are one click away', async ({ page, renderlint }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page.getByText('Churn by plan')).toBeVisible();
  const found = await renderlint('reports list');
  expect(Array.isArray(found)).toBe(true);
  await expect(page.getByText('Churn by plan')).toBeVisible(); // still there, still usable
});
