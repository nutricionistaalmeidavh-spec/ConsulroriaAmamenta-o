import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // P0 validates application/runtime behavior. Service-worker cache/update behavior is
    // a separate P1 concern; blocking it here also makes request-failure injection deterministic.
    serviceWorkers: 'block',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--disable-gpu'] } : {},
    trace: 'retain-on-failure', screenshot: 'only-on-failure'
  },
  reporter: [['list'], ['html', { outputFolder: 'artifacts/playwright-report', open: 'never' }]],
  outputDir: 'artifacts/e2e-results',
  // Keep the SW install/activation lifecycle in its own Chromium worker/browser.
  // The functional suite blocks service workers for deterministic fault injection.
  projects: [
    { name: 'chromium',
      testIgnore: ['**/pwa-cache-p1.spec.mjs', '**/deploy-version-upgrade.spec.mjs'],
      use: { ...devices['Desktop Chrome'] } },
    { name: 'chromium-upgrade', testMatch: '**/deploy-version-upgrade.spec.mjs',
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' } },
    { name: 'chromium-service-worker', testMatch: '**/pwa-cache-p1.spec.mjs',
      use: { ...devices['Desktop Chrome'], serviceWorkers: 'allow' } },
  ],
  webServer: { command: 'node tests/e2e/server.mjs', url: 'http://127.0.0.1:4174', reuseExistingServer: false, timeout: 60000 },
});
