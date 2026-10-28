import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function listRecords(page, table, filter) {
  const response = await page.request.get(`/api/clinical/records/${table}?${filter}`, { headers: await authHeaders(page) });
  expect(response.status()).toBe(200);
  return response.json();
}

test('mother-only prenatal lifecycle links newborn later without rewriting prenatal history', async ({ page }) => {
  await login(page);
  const motherName = uniqueLabel('Gestante');

  await page.locator('[data-action="new-patient"]:visible').first().click();
  await expect(page.locator('[data-baby-field="name"]').first()).toBeVisible();
  await page.locator('[name="motherName"]').fill(motherName);
  await page.locator('[name="consentData"]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const patient = await createdResponse.json();
  expect(patient.babies).toHaveLength(0);
  await expect(page.locator('[data-patient-title]')).toHaveText(motherName);
  await expect(page.locator('[data-action="patient-add-baby"]:visible')).toHaveCount(1);

  await page.locator('[data-action="new-appointment"]:visible').click();
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Pré-natal"]').click();
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now()+3600000).toISOString().slice(0,16));
  const start = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  const startResponse = await start;
  expect(startResponse.status()).toBe(200);
  const ids = await startResponse.json();

  const prenatal = (await listRecords(page, 'clinical_encounters', `id=eq.${ids.encounter_id}`))[0];
  expect(prenatal.mother_id).toBe(patient.mother.id);
  expect(prenatal.baby_id).toBeNull();
  const appointment = (await listRecords(page, 'appointments', `id=eq.${ids.appointment_id}`))[0];
  expect(appointment.appointment_type).toBe('Pré-natal');
  expect(appointment.baby_id).toBeNull();

  await page.locator('[data-wizard-close]').click();
  await expect(page.locator('[data-patient-title]')).toHaveText(motherName);
  await page.locator('[data-action="patient-add-baby"]:visible').click();
  await expect(page.locator('[data-patient-form]')).toBeVisible();
  await page.locator('[data-baby-field="name"]').last().fill('Bebê cadastrado após o parto');
  const updated = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const updatedResponse = await updated;
  expect(updatedResponse.status()).toBe(200);
  const edited = await updatedResponse.json();
  expect(edited.mother.id).toBe(patient.mother.id);
  expect(edited.babies).toHaveLength(1);
  expect(edited.babies[0].mother_id).toBe(patient.mother.id);
  await expect(page.locator('[data-patient-title]')).toContainText('Bebê cadastrado após o parto');

  // The mother-only prenatal draft must remain visible even after a baby tab exists.
  await expect(page.locator('[data-patient-timeline-live]')).toContainText('Rascunho');
  expect((await listRecords(page, 'clinical_encounters', `id=eq.${ids.encounter_id}`))[0].baby_id).toBeNull();
  expect((await listRecords(page, 'babies', `mother_id=eq.${patient.mother.id}`))).toHaveLength(1);

  await page.reload();
  await expect(page.locator('[data-patient-title]')).toContainText('Bebê cadastrado após o parto');
  await expect(page.locator('[data-patient-timeline-live]')).toContainText('Rascunho');
});
