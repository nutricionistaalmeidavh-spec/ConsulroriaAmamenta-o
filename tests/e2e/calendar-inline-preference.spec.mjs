import { test, expect } from './fixtures.mjs';
import { login, authHeaders } from './helpers.mjs';

test('calendar cards show inline auto-saving name checkbox with shared persisted preference', async ({ page }) => {
  await login(page);
  await page.locator('[data-nav-target="settings"]:visible').first().click();
  const apple = page.locator('[data-apple-calendar-integration] [data-calendar-display-inline]');
  const outlook = page.locator('[data-outlook-calendar-integration] [data-calendar-display-inline]');
  await expect(apple).toBeVisible();
  await expect(outlook).toBeVisible();
  await expect(apple).toBeEnabled();
  await expect(outlook).toBeEnabled();

  // No extra card, radio selection, confirmation dialog or Save button.
  await expect(page.locator('[data-calendar-display-card]')).toHaveCount(0);
  await expect(page.locator('[data-calendar-display-save]')).toHaveCount(0);
  const before = await page.request.get('/api/calendar/display-preferences', { headers: await authHeaders(page) });
  expect(before.ok()).toBeTruthy();
  expect((await before.json()).show_patient_name).toBe(false);

  await apple.check();
  await expect(apple).toBeChecked();
  await expect(outlook).toBeChecked();
  const status = page.locator('[data-apple-calendar-integration] [data-calendar-display-status]');
  await expect(status).toContainText('Salvo');
  const after = await page.request.get('/api/calendar/display-preferences', { headers: await authHeaders(page) });
  expect((await after.json()).show_patient_name).toBe(true);

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target="settings"]:visible').first().click();
  await expect(apple).toBeEnabled();
  await expect(apple).toBeChecked();
  await expect(outlook).toBeChecked();
  await outlook.uncheck();
  await expect(apple).not.toBeChecked();
  await expect(outlook).not.toBeChecked();
  await expect(status).toContainText('Salvo');
  const reset = await page.request.get('/api/calendar/display-preferences', { headers: await authHeaders(page) });
  expect((await reset.json()).show_patient_name).toBe(false);
});
