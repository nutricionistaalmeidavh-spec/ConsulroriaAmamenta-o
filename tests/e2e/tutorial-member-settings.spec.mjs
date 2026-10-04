import { test, expect } from './fixtures.mjs';
import { login, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const mother = uniqueLabel('Tutorial área mãe');
  const baby = uniqueLabel('Tutorial bebê');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(mother);
  await page.locator('[data-baby-field="name"]').first().fill(baby);
  await page.locator('[name=consentData]').check();
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toContainText(mother);
  return mother;
}

test('tutorial configurações ajusta PDF e gerencia Área da Mãe', async ({ page }) => {
  await login(page);
  const mother = await createPatient(page);

  await page.locator('[data-nav-target="settings"]:visible').first().click();
  const settings = page.locator('[data-screen="settings"]');
  await expect(settings).toBeVisible();

  const layout = settings.locator('[data-pdf-layout-default]');
  await layout.selectOption('clinico');
  await expect(layout).toHaveValue('clinico');
  await expect(page.locator('[data-app-toast]')).toContainText('Modelo padrão do PDF atualizado');

  await expect(settings.locator('[data-action="backup-export"]')).toBeVisible();
  await expect(settings.locator('[data-action="backup-restore"]')).toBeVisible();

  const memberButton = settings.locator('[data-member-admin]');
  await expect(memberButton).toBeVisible();
  await memberButton.click();

  const overlay = page.locator('#mf-admin-overlay');
  await expect(overlay).toBeVisible();
  await expect(overlay.locator('#mf-mother')).toContainText(mother);

  const accessEmail = `tutorial.${Date.now()}@example.invalid`;
  await overlay.locator('#mf-email').fill(accessEmail);
  await overlay.locator('#mf-tier').selectOption('premium');
  await overlay.locator('#mf-save-access').click();
  await expect(page.locator('.mf-toast')).toContainText('Acesso atualizado');

  await overlay.locator('[data-tab="publish"]').click();
  await expect(overlay.locator('[data-pane="publish"]')).toHaveClass(/active/);
  await overlay.locator('#mf-title').fill('Resumo seguro de demonstração');
  await overlay.locator('#mf-body').fill('Conteúdo fictício e seguro para demonstrar a Área da Mãe.');
  await overlay.locator('#mf-publish').click();
  await expect(page.locator('.mf-toast')).toContainText('Publicado para a mãe');
  await expect(overlay).toContainText('Resumo seguro de demonstração');

  await overlay.locator('[data-tab="engagement"]').click();
  await expect(overlay.locator('[data-pane="engagement"]')).toHaveClass(/active/);
  await expect(overlay).toContainText('ENGAJAMENTO INTERNO');
});
