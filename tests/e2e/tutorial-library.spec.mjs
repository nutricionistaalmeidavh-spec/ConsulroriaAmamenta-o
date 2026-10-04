import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';

test('QA registra que Biblioteca está temporariamente desativada neste release', async ({ page }) => {
  await login(page);

  const nav = page.locator('[data-nav-target="library"]').first();
  await expect(nav).toBeHidden();
  await expect(page.locator('[data-screen="library"]')).toBeHidden();

  await page.evaluate(() => { location.hash = '#/library'; });
  await expect.poll(() => page.evaluate(() => location.hash)).not.toMatch(/library|biblioteca/i);
  await expect(page.locator('[data-library-disabled-toast]')).toContainText('Biblioteca temporariamente desativada');
});
