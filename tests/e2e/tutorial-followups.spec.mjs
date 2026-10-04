import { test, expect } from './fixtures.mjs';
import { login, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const mother = uniqueLabel('Tutorial followup mãe');
  const baby = uniqueLabel('Tutorial followup bebê');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(mother);
  await page.locator('[data-baby-field="name"]').first().fill(baby);
  await page.locator('[name=consentData]').check();
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toContainText(mother);
  return { mother, baby };
}

test('tutorial followup cria acompanhamento e conclui pela tela de continuidade', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);

  await page.locator('[data-nav-target="followups"]:visible').first().click();
  await expect(page.locator('[data-screen="followups"]')).toBeVisible();

  let dialogIndex = 0;
  page.on('dialog', async dialog => {
    dialogIndex += 1;
    const message = dialog.message();
    if (message.includes('Escolha a paciente')) return dialog.accept('1');
    if (message.includes('Quando?')) {
      const due = new Date(Date.now() + 48 * 60 * 60 * 1000);
      const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      return dialog.accept(local);
    }
    if (message.includes('O que você quer verificar?')) return dialog.accept('Revisar conforto, pega e evolução');
    return dialog.accept();
  });

  await page.locator('[data-action="new-followup"]').click();
  const board = page.locator('[data-followups-live]');
  await expect(board).toContainText(patient.mother);
  await expect(board).toContainText('Revisar conforto, pega e evolução');
  expect(dialogIndex).toBeGreaterThanOrEqual(3);

  const card = board.locator('.followup-card').filter({ hasText: patient.mother }).first();
  await expect(card.locator('[data-action="followup-whatsapp"]')).toBeVisible();
  await card.locator('[data-action="complete-followup"]').click();

  await expect(board).not.toContainText(patient.mother);
});
