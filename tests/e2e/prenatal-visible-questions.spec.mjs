import { test, expect } from './fixtures.mjs';
import { login, uniqueLabel } from './helpers.mjs';

test('Pré-natal replaces all postpartum steps in the live canonical browser and restores them on switching mode', async ({ page }) => {
  await login(page);
  const motherName = uniqueLabel('Gestante roteiro');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name="motherName"]').fill(motherName);
  await page.locator('[name="consentData"]').check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  expect((await saved).status()).toBe(201);

  await expect(page.locator('[data-patient-title]')).toHaveText(motherName);
  await page.locator('[data-screen="patient"] [data-action="new-appointment"]:visible').click();
  await expect(page.locator('[data-screen="appointment"]')).toBeVisible();
  await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Pré-natal"]').click();
  const screen = page.locator('[data-screen="appointment"]');
  await expect(screen).toHaveAttribute('data-prenatal-mode', 'true');
  await expect(screen.locator('[data-prenatal-number]')).toHaveCount(17);
  await expect(screen.locator('[data-baby-target-field]')).toBeHidden();

  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  await page.locator('[data-wizard-next]').click();
  const step2 = screen.locator('[data-wizard-step="2"]');
  await expect(step2.locator('[data-prenatal-number="1"]')).toBeVisible();
  await expect(step2.getByText('Queixa principal')).toBeHidden();
  await expect(step2.getByText('Dificuldade de pega')).toBeHidden();

  await page.locator('[data-wizard-next]').click();
  const step3 = screen.locator('[data-wizard-step="3"]');
  await expect(step3.locator('[data-prenatal-number="4"]')).toBeVisible();
  await expect(step3.getByText('Dor (0–10)')).toBeHidden();
  await expect(step3.getByText('Fissura', { exact: true })).toBeHidden();

  await page.locator('[data-wizard-next]').click();
  const step4 = screen.locator('[data-wizard-step="4"]');
  await expect(step4.locator('[data-prenatal-number="10"]')).toBeVisible();
  await expect(step4.getByText('Avaliação do bebê')).toBeHidden();
  // Component replacement must be recovered by the observer without a full reload.
  await step4.locator('[data-prenatal-form]').evaluate((panel) => panel.remove());
  await expect(step4.locator('[data-prenatal-number="10"]')).toBeVisible();
  await expect(screen.locator('[data-prenatal-form]')).toHaveCount(6);


  await page.locator('[data-wizard-next]').click();
  const step5 = screen.locator('[data-wizard-step="5"]');
  await expect(step5.locator('[data-prenatal-number="14"]')).toBeVisible();
  await expect(step5.getByText('Avaliação da mamada')).toBeHidden();

  await page.locator('[data-wizard-next]').click();
  const step6 = screen.locator('[data-wizard-step="6"]');
  await expect(step6.locator('[data-prenatal-number="16"]')).toBeVisible();
  await expect(step6.locator('[data-prenatal-number="17"]')).toBeVisible();
  await expect(step6.getByText('Pega adequada')).toBeHidden();
  await expect(step6.getByText('Ordenha / complemento, se aplicável')).toBeHidden();
  await expect(step6.locator('[data-prenatal-answer="consultationAuthorization"]')).not.toBeChecked();
  // Hidden legacy inputs must not enter the saved prenatal payload.
  for (const number of [2,3,4,5,6]) {
    await expect(screen.locator(`[data-wizard-step="${number}"] > :not([data-prenatal-form]) [data-section]`)).toHaveCount(0);
  }
  await page.locator('[data-wizard-next]').click();
  const step7 = screen.locator('[data-wizard-step="7"]');
  await expect(step7.getByText('Finalização do pré-natal')).toBeVisible();
  await expect(step7.getByText('Follow-up', { exact: true })).toBeHidden();
  await expect(step7.locator('[data-action="print-plan"]')).toBeHidden();
  await page.locator('[data-wizard-prev]').click();

  // Switching modes must restore the existing postpartum workflow.
  for (let step = 6; step > 1; step--) await page.locator('[data-wizard-prev]').click();
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Consulta inicial"]').click();
  await expect(screen).toHaveAttribute('data-prenatal-mode', 'false');
  await page.locator('[data-wizard-next]').click();
  await expect(step2.getByText('Queixa principal')).toBeVisible();
  await expect(step2.locator('[data-prenatal-number="1"]')).toBeHidden();
  // Hydration of an existing draft updates aria-pressed programmatically (no click).
  // The observer must update visibility and section isolation for that path too.
  await page.evaluate(() => {
    document.querySelector('[data-encounter-choice][data-field="appointmentType"][data-value="Consulta inicial"]').setAttribute('aria-pressed', 'false');
    document.querySelector('[data-encounter-choice][data-field="appointmentType"][data-value="Pré-natal"]').setAttribute('aria-pressed', 'true');
  });
  await expect(screen).toHaveAttribute('data-prenatal-mode', 'true');
  await expect(step2.locator('[data-prenatal-number="1"]')).toBeVisible();
  await expect(step2.getByText('Queixa principal')).toBeHidden();
  await page.evaluate(() => {
    document.querySelector('[data-encounter-choice][data-field="appointmentType"][data-value="Pré-natal"]').setAttribute('aria-pressed', 'false');
    document.querySelector('[data-encounter-choice][data-field="appointmentType"][data-value="Consulta inicial"]').setAttribute('aria-pressed', 'true');
  });
  await expect(screen).toHaveAttribute('data-prenatal-mode', 'false');
  await expect(step2.getByText('Queixa principal')).toBeVisible();
});
