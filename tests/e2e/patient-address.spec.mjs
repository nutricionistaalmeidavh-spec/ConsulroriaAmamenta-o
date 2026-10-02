import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function record(page, table, query) {
  const response = await page.request.get(`/api/clinical/records/${table}?${query}`, { headers: await authHeaders(page) });
  expect(response.ok(), `${table} read failed: ${response.status()}`).toBeTruthy();
  return (await response.json())[0] ?? null;
}

test('patient address is saved once, inherited by a new visit and can be overridden without changing the patient default', async ({ page }) => {
  await login(page);
  const motherName = uniqueLabel('Address mother');
  const babyName = uniqueLabel('Address baby');
  const defaultAddress = 'Rua Endereço Padrão, 123 - Centro';
  const visitAddress = 'Avenida Atendimento, 456 - Jardim';

  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[name=motherAddress]').fill(defaultAddress);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();

  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  const patient = await createResponse.json();
  expect(patient.mother.address).toBe(defaultAddress);

  await expect(page.locator('[data-mother-address]')).toHaveText(defaultAddress);
  await page.locator('[data-action="edit-patient"]:visible').first().click();
  await expect(page.locator('[name=motherAddress]')).toHaveValue(defaultAddress);
  await page.locator('[data-nav-target="patients"]:visible').first().click();
  await page.goto(`/app/#/patient/${patient.mother.id}`);
  await expect(page.locator('[data-patient-title]')).toContainText(motherName);

  await page.locator('[data-action="new-appointment"]:visible').first().click();
  const addressField = page.locator('[data-encounter-field="address"]');
  await expect(addressField).toBeVisible();
  await expect(addressField).toHaveValue(defaultAddress);

  await addressField.fill(visitAddress);
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const started = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  const startResponse = await started;
  expect(startResponse.ok()).toBeTruthy();
  const identity = await startResponse.json();

  const appointment = await record(page, 'appointments', `id=eq.${encodeURIComponent(identity.appointment_id)}&limit=1`);
  expect(appointment.address).toBe(visitAddress);

  const mother = await record(page, 'mothers', `id=eq.${encodeURIComponent(patient.mother.id)}&limit=1`);
  expect(mother.address).toBe(defaultAddress);
});
