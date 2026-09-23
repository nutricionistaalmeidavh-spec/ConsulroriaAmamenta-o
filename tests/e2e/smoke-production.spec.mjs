import { test, expect } from '@playwright/test';

const enabled = process.env.E2E_SMOKE_ENABLED === '1';
const email = process.env.E2E_SMOKE_EMAIL || '';
const password = process.env.E2E_SMOKE_PASSWORD || '';

test.skip(!enabled, 'Production smoke is opt-in. Set E2E_SMOKE_ENABLED=1 explicitly.');

test('post-deploy smoke authenticates the dedicated synthetic account without clinical writes', async ({ page }) => {
  expect(email, 'E2E_SMOKE_EMAIL is required when smoke is enabled').toBeTruthy();
  expect(password, 'E2E_SMOKE_PASSWORD is required when smoke is enabled').toBeTruthy();

  const landing = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(landing?.ok()).toBeTruthy();

  await page.goto('/app/');
  await expect(page.locator('[data-login-form]')).toBeVisible();
  await page.locator('[data-login-form] [name=email]').fill(email);
  await page.locator('[data-login-form] [name=password]').fill(password);
  await page.locator('[data-login-form] button[type=submit]').click();
  await expect(page.locator('[data-app-root]')).toBeVisible();

  const accessToken = await page.evaluate(() => JSON.parse(localStorage.getItem('debora-lactacao-session'))?.access_token || '');
  expect(accessToken).toBeTruthy();
  const list = await page.request.get('/api/clinical/records/mothers?select=id&limit=1', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(list.ok()).toBeTruthy();
  expect(Array.isArray(await list.json())).toBeTruthy();

  await page.locator('[data-nav-target=settings]:visible').first().click();
  await page.locator('[data-action=logout]:visible').first().click();
  await expect(page.locator('[data-login-form]')).toBeVisible();
});
