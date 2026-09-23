import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  clinicalIsolation: [async ({}, use) => {
    const response = await fetch('http://127.0.0.1:4174/control/reset-clinical', { method: 'POST' });
    if (!response.ok) throw new Error(`Unable to reset local clinical state: ${response.status} ${await response.text()}`);
    await use();
  }, { auto: true }],
});

export { expect };
