import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

test('disabled mother portal hash returns to the professional app instead of mounting the portal', async ({ page }) => {
  await page.goto('/app/#mae', { waitUntil: 'domcontentloaded' });

  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  await expect(page.locator('#member-portal-root')).toHaveCount(0);
  await expect(page.locator('.mp-login')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Área das Mães' })).toHaveCount(0);
});

test('professional/login UI never exposes the disabled mother portal entry points', async ({ page }) => {
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);

  await expect(page.locator('[data-member-admin]')).toHaveCount(0);
  await expect(page.locator('[data-mother-link]')).toHaveCount(0);
  await expect(page.getByText('Sou mãe · acessar minha área', { exact: true })).toHaveCount(0);
});
