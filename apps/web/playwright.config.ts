import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the real API + web servers with a freshly reset and seeded database.
 * Start them first:  npm run dev:api  and  npm run dev:web  (Docker services up).
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 15_000, navigationTimeout: 45_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
});
