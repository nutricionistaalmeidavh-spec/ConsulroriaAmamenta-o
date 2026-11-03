import { test, expect } from './fixtures.mjs';
import { authHeaders, login, uniqueLabel } from './helpers.mjs';

test('pré-natal mantém prontuário como última etapa, salva evolução no D1 e conclui somente após continuar no editor', async ({ page }) => {
  await login(page);
  const mother = uniqueLabel('Gestante prontuario final');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name="motherName"]').fill(mother);
  await page.locator('[name="consentData"]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  expect((await created).status()).toBe(201);
  await expect(page.locator('[data-patient-title]')).toHaveText(mother);

  await page.locator('[data-screen="patient"] [data-action="new-appointment"]:visible').click();
  const screen = page.locator('[data-screen="appointment"]');
  await expect(screen).toBeVisible();
  await screen.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Pré-natal"]').click();
  await expect(screen).toHaveAttribute('data-prenatal-mode', 'true');
  await screen.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 3600000).toISOString().slice(0,16));

  await page.locator('[data-wizard-next]').click();
  await expect(screen.locator('[data-wizard-step="2"] [data-prenatal-number="1"]')).toBeVisible();
  const encounterId = await screen.getAttribute('data-encounter-id');
  expect(encounterId).toBeTruthy();

  for (let step = 3; step <= 6; step++) {
    await page.locator('[data-wizard-next]').click();
    await expect(screen.locator(`[data-wizard-step="${step}"] [data-prenatal-form]`)).toBeVisible();
    await expect(page.locator('#cn-overlay')).toHaveCount(0);
  }
  await screen.locator('[data-prenatal-answer="declaration"]').check();
  await page.locator('[data-wizard-next]').click();

  const last = screen.locator('[data-wizard-step="7"]');
  await expect(last.locator('[data-prenatal-form]')).toBeVisible();
  await expect(last.getByRole('heading',{name:'Prontuário'})).toBeVisible();
  await expect(screen.locator('[data-wizard-next]')).toHaveText('Abrir prontuário');
  await expect(page.locator('#cn-overlay')).toHaveCount(0);

  // Closing the note without completing must leave the appointment unfinished.
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('#cn-overlay #cn-note')).toBeVisible();
  await expect(page.locator('#cn-overlay [data-cn-continue]')).toHaveText('Salvar prontuário e concluir');
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);
  await expect(last.locator('[data-prenatal-form]')).toBeVisible();

  // The existing canonical note editor owns the note and persists it.
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('#cn-note')).toBeVisible();
  const note = uniqueLabel('Evolução clínica pré-natal');
  await page.locator('#cn-note').fill(note);
  await page.locator('#cn-overlay [data-cn-continue]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);
  await expect(page.locator('[data-screen="patient"]')).toBeVisible();

  const response = await page.request.get(
    `/api/clinical/records/clinical_encounters?id=eq.${encounterId}&select=id,status,clinical_note,mother_id,baby_id&limit=1`,
    {headers:await authHeaders(page)}
  );
  expect(response.ok()).toBeTruthy();
  const [saved] = await response.json();
  expect(saved?.status).toBe('finalized');
  expect(saved?.clinical_note).toBe(note);
  expect(saved?.baby_id).toBeNull();
});
