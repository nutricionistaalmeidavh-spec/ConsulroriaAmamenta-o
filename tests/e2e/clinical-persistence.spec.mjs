import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const motherName = uniqueLabel('Encounter mother');
  const babyName = uniqueLabel('Encounter baby');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  return response.json();
}

test('clinical encounter remains linked to the same mother and baby after browser reload', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const startsAt = new Date().toISOString();

  const started = await page.request.post('/api/clinical/rpc/start_clinical_encounter', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: startsAt,
      p_duration_min: 60,
      p_appointment_type: 'E2E synthetic encounter',
      p_format: 'Domiciliar',
      p_value_cents: 0,
      p_payment_status: 'Pendente',
    },
  });
  expect(started.ok()).toBeTruthy();
  const ids = await started.json();
  expect(ids.encounter_id).toBeTruthy();
  expect(ids.appointment_id).toBeTruthy();

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  const reloadedHeaders = await authHeaders(page);
  const encounterResponse = await page.request.get(`/api/clinical/records/clinical_encounters?id=eq.${encodeURIComponent(ids.encounter_id)}&limit=1`, { headers: reloadedHeaders });
  expect(encounterResponse.ok()).toBeTruthy();
  const encounters = await encounterResponse.json();
  expect(encounters).toHaveLength(1);
  expect(encounters[0].mother_id).toBe(patient.mother.id);
  expect(encounters[0].baby_id).toBe(patient.babies[0].id);
  expect(encounters[0].appointment_id).toBe(ids.appointment_id);
  expect(encounters[0].status).toBe('draft');

  const linksResponse = await page.request.get(`/api/clinical/records/clinical_encounter_babies?encounter_id=eq.${encodeURIComponent(ids.encounter_id)}`, { headers: reloadedHeaders });
  expect(linksResponse.ok()).toBeTruthy();
  const links = await linksResponse.json();
  expect(links).toHaveLength(1);
  expect(links[0].baby_id).toBe(patient.babies[0].id);
});
