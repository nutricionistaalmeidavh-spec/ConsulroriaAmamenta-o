import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';

test('tutorial dashboard apresenta resumo e atalhos principais da rotina', async ({ page }) => {
  await login(page);

  const home = page.locator('[data-screen="home"]');
  await expect(home).toBeVisible();
  await expect(page.locator('[data-home-greeting]')).toBeVisible();
  await expect(page.locator('[data-home-summary]')).toBeVisible();
  await expect(page.locator('[data-kpi-followups]')).toBeVisible();

  const quickActions = home.locator('.quick-actions-grid');
  await expect(quickActions).toContainText('Novo atendimento');
  await expect(quickActions).toContainText('Nova paciente');
  await expect(quickActions).toContainText('Follow-up');
  await expect(quickActions).toContainText('Pagamento');

  await quickActions.locator('[data-action="new-patient"]').click();
  await expect(page.locator('[data-screen="patient-form"]')).toBeVisible();
  await page.locator('[data-screen="patient-form"] [data-nav-target="patients"]').first().click();
  await expect(page.locator('[data-screen="patients"]')).toBeVisible();

  await page.locator('[data-nav-target="home"]:visible').first().click();
  await expect(home).toBeVisible();

  await quickActions.locator('[data-nav-target="followups"]').click();
  await expect(page.locator('[data-screen="followups"]')).toBeVisible();

  await page.locator('[data-nav-target="home"]:visible').first().click();
  await expect(home).toBeVisible();

  await quickActions.locator('[data-nav-target="finance"]').click();
  await expect(page.locator('[data-screen="finance"]')).toBeVisible();
});
