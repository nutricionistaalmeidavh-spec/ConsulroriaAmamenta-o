import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZAAAAAElFTkSuQmCC',
  'base64',
);

async function records(page, table, query = '') {
  const response = await page.request.get(`/api/clinical/records/${table}${query ? `?${query}` : ''}`, {
    headers: await authHeaders(page),
  });
  expect(response.ok(), `${table} read failed: ${response.status()}`).toBeTruthy();
  return response.json();
}

async function createPatientThroughUi(page) {
  const motherName = uniqueLabel('Final gate mother');
  const babyName = uniqueLabel('Final gate baby');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  await page.locator('[name=consentClinicalMedia]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
  return { patient, motherName, babyName };
}

test('final materialized build completes the critical clinical flow through real UI actions and persists the same state', async ({ page }) => {
  await login(page);
  const { patient, motherName } = await createPatientThroughUi(page);

  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();
  await expect(page.locator('[data-billing-v2]')).toBeVisible();

  await page.locator('[data-bv-mode]').selectOption('package_new');
  await page.locator('[data-bv-total]').fill('600.00');
  await page.locator('[data-bv-sessions]').fill('3');
  await page.locator('[data-bv-payment]').selectOption({ label: 'Pix' });
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));

  const started = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  expect((await started).ok()).toBeTruthy();
  await expect(page.locator('[data-wizard-step="2"]')).toBeVisible();

  const appointmentScreen = page.locator('[data-screen="appointment"]');
  const encounterId = await appointmentScreen.getAttribute('data-encounter-id');
  const appointmentId = await appointmentScreen.getAttribute('data-appointment-id');
  expect(encounterId).toBeTruthy();
  expect(appointmentId).toBeTruthy();

  const complaint = uniqueLabel('Final complaint');
  const clinicalNote = uniqueLabel('Final clinical note');
  await page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]').fill(complaint);
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await page.locator('#cn-note').fill(clinicalNote);
  await page.locator('#cn-overlay [data-cn-continue]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);
  await expect(page.locator('[data-wizard-step="3"]')).toBeVisible();

  await page.locator('[data-clinical-media-input]').setInputFiles({
    name: 'final-gate.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="4"]')).toBeVisible();

  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="5"]')).toBeVisible();
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="6"]')).toBeVisible();

  const objective = uniqueLabel('Final objective');
  const instructions = uniqueLabel('Final instructions');
  await page.locator('[data-wizard-step="6"] [data-encounter-field="objectives"]').fill(objective);
  await page.locator('[data-wizard-step="6"] [data-encounter-field="instructions"]').fill(instructions);
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="7"]')).toBeVisible();

  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName, { timeout: 20_000 });
  await expect(page.locator('[data-app-toast]')).toContainText('Atendimento salvo com segurança.');

  const [encounter] = await records(page, 'clinical_encounters', `id=eq.${encodeURIComponent(encounterId)}&limit=1`);
  expect(encounter?.status).toBe('finalized');
  expect(encounter?.mother_id).toBe(patient.mother.id);
  expect(encounter?.baby_id).toBe(patient.babies[0].id);
  expect(encounter?.appointment_id).toBe(appointmentId);
  expect(encounter?.chief_complaint?.notes).toBe(complaint);
  expect(encounter?.clinical_note).toBe(clinicalNote);
  expect(encounter?.care_plan?.objectives).toBe(objective);
  expect(encounter?.care_plan?.instructions).toBe(instructions);

  const [appointment] = await records(page, 'appointments', `id=eq.${encodeURIComponent(appointmentId)}&limit=1`);
  expect(appointment?.status).toBe('Realizado');
  expect(appointment?.billing_mode).toBe('package_new');

  const packages = await records(page, 'care_packages', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  expect(packages).toHaveLength(1);
  expect(Number(packages[0].total_cents)).toBe(60000);
  expect(Number(packages[0].sessions_total)).toBe(3);
  expect(Number(packages[0].sessions_used)).toBe(1);

  const financial = await records(page, 'financial_entries', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  const packageCharges = financial.filter(row => row.package_id === packages[0].id);
  expect(packageCharges).toHaveLength(1);
  expect(Number(packageCharges[0].amount_cents)).toBe(60000);

  const media = await records(page, 'media', `encounter_id=eq.${encodeURIComponent(encounterId)}`);
  expect(media).toHaveLength(1);

  await page.locator(`[data-action="open-clinical-note"][data-encounter-id="${encounterId}"]`).click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await expect(page.locator('#cn-overlay')).toContainText(motherName);
  await expect(page.locator('#cn-note')).toHaveValue(clinicalNote);
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);

  await expect(page.locator('[data-prh-card]')).toBeVisible();
  await page.locator('[data-prh-target="album"]').click();
  await expect(page.locator('.pw-photo img')).toHaveCount(1);
  const signedSrc = await page.locator('.pw-photo img').getAttribute('src');
  expect(signedSrc).toBeTruthy();
  const mediaGet = await page.request.get(signedSrc);
  expect(mediaGet.status()).toBe(200);
  expect((await mediaGet.body()).byteLength).toBeGreaterThan(0);
  await page.locator('[data-pw-close]').click();

  await page.locator('[data-nav-target="patients"]:visible').first().click();
  await expect(page.locator(`[data-action="open-patient"][data-patient-id="${patient.mother.id}"]`)).toBeVisible();
  await page.locator(`[data-action="open-patient"][data-patient-id="${patient.mother.id}"]`).click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName);
});
