import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    video: 'on',
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
  outputDir: 'artifacts/tutorial-web-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/tutorial-web-report', open: 'never' }],
  ],
});
