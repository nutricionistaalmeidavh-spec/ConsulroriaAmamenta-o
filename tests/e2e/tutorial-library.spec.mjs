import { test, expect } from './fixtures.mjs';
import { login, uniqueLabel } from './helpers.mjs';

test('tutorial biblioteca cria orientação reutilizável e abre central de templates', async ({ page }) => {
  await login(page);

  await page.locator('[data-nav-target="library"]:visible').first().click();
  const library = page.locator('[data-screen="library"]');
  await expect(library).toBeVisible();
  await expect(library.locator('.library-card')).toHaveCount(4);

  const title = uniqueLabel('Orientação tutorial');
  await expect(library.locator('[data-library-custom]')).toBeVisible();
  await library.locator('[data-lf-new]').click();
  await expect(page.locator('#lf-item-form')).toBeVisible();
  await page.locator('#lf-item-form [name=title]').fill(title);
  await page.locator('#lf-item-form [name=category]').fill('Orientação');
  await page.locator('#lf-item-form [name=content]').fill('Orientação fictícia para demonstração do fluxo da biblioteca.');
  await page.locator('#lf-item-form button[type=submit]').click();

  const custom = library.locator('.lf-custom-card').filter({ hasText: title });
  await expect(custom).toBeVisible();
  await expect(custom.locator('[data-share]')).toBeVisible();
  await expect(custom.locator('[data-use]')).toBeVisible();

  await page.locator('[data-nav-target="settings"]:visible').first().click();
  await expect(page.locator('[data-screen="settings"]')).toBeVisible();
  await expect(page.locator('[data-template-center]')).toBeVisible();
  await page.locator('[data-template-center]').click();
  await expect(page.locator('#lf-template-form')).toBeVisible();
  await expect(page.locator('#lf-overlay')).toContainText('Central de templates');
  await page.locator('#lf-overlay [data-lf-close]').first().click();
  await expect(page.locator('#lf-overlay')).toHaveCount(0);
});
