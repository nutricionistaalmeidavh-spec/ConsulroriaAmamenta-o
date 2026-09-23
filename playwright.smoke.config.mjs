import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_SMOKE_BASE_URL || 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'smoke-production.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-smoke-report', open: 'never' }]],
  outputDir: 'artifacts/e2e-smoke-results',
  projects: [{ name: 'chromium-smoke', use: { ...devices['Desktop Chrome'] } }],
});
