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
  const initialAddress = 'Rua Endereço Inicial, 10 - Centro';
  const defaultAddress = 'Rua Endereço Padrão, 123 - Centro';
  const visitAddress = 'Avenida Atendimento, 456 - Jardim';

  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[name=motherAddress]').fill(initialAddress);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();

  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const createResponse = await created;
  expect(createResponse.status()).toBe(201);
  const patient = await createResponse.json();
  expect(patient.mother.address).toBe(initialAddress);

  await expect(page.locator('[data-mother-address]')).toHaveText(initialAddress);
  await page.locator('[data-action="edit-patient"]:visible').first().click();
  await expect(page.locator('[name=motherAddress]')).toHaveValue(initialAddress);
  await page.locator('[name=motherAddress]').fill(defaultAddress);
  const updated = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  expect((await updated).status()).toBe(200);
  await expect(page.locator('[data-mother-address]')).toHaveText(defaultAddress);
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

  // Online must never inherit the patient's residential address.
  await page.locator('[data-wizard-close]:visible').click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName);
  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(addressField).toHaveValue(defaultAddress);
  await page.locator('[data-encounter-choice][data-field="format"][data-value="Online"]').click();
  await expect(addressField).toHaveValue('');
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const onlineStarted = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  const onlineIdentity = await (await onlineStarted).json();
  const onlineAppointment = await record(page, 'appointments', `id=eq.${encodeURIComponent(onlineIdentity.appointment_id)}&limit=1`);
  expect(onlineAppointment.format).toBe('Online');
  expect(String(onlineAppointment.address || '')).toBe('');

  // Presencial may use an explicit location, but must not inherit the home address.
  await page.locator('[data-wizard-close]:visible').click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName);
  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(addressField).toHaveValue(defaultAddress);
  await page.locator('[data-encounter-choice][data-field="format"][data-value="Presencial"]').click();
  await expect(addressField).toHaveValue('');
  const clinicAddress = 'Clínica Centro, Sala 4';
  await addressField.fill(clinicAddress);
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 16));
  const presencialStarted = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  const presencialIdentity = await (await presencialStarted).json();
  const presencialAppointment = await record(page, 'appointments', `id=eq.${encodeURIComponent(presencialIdentity.appointment_id)}&limit=1`);
  expect(presencialAppointment.format).toBe('Presencial');
  expect(presencialAppointment.address).toBe(clinicAddress);

  const motherAfterAllFormats = await record(page, 'mothers', `id=eq.${encodeURIComponent(patient.mother.id)}&limit=1`);
  expect(motherAfterAllFormats.address).toBe(defaultAddress);
});
