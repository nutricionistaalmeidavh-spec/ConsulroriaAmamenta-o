import { defineConfig } from '@playwright/test';
import base from './playwright.mobile.config.mjs';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    video: 'on',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  outputDir: 'artifacts/tutorial-mobile-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/tutorial-mobile-report', open: 'never' }],
  ],
});
