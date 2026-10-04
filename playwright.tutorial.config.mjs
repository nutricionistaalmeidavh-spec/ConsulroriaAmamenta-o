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
  outputDir: 'artifacts/tutorial-desktop-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'artifacts/tutorial-desktop-report', open: 'never' }],
  ],
});
