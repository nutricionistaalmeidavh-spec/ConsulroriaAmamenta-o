import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testDir: './tests/e2e',
  testMatch: ['google-oauth-video.spec.mjs'],
  timeout: 120_000,
  use: {
    ...base.use,
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 20_000,
  },
  reporter: [['list']],
  outputDir: 'artifacts/google-calendar-qa-test-results',
});
