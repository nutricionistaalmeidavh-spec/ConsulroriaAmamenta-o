import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('disabled mother portal hash returns to the professional app instead of mounting the portal', async ({ page }) => {
  await page.goto('/app/#mae', { waitUntil: 'domcontentloaded' });

  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#member-portal-root')).toHaveCount(0);
  await expect(page.locator('.mp-login')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Área das Mães' })).toHaveCount(0);
});
