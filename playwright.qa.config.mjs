import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'qa-visual-journey.spec.mjs',
  workers: 1,
  fullyParallel: false,
  timeout: 180000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu'] }
      : {},
  },
  reporter: [['list'], ['html', { outputFolder: 'artifacts/qa-visual/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/qa-visual/playwright-results',
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5, acceptDownloads: true } },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', acceptDownloads: true } },
  ],
  webServer: {
    command: 'node tests/e2e/server.mjs',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
