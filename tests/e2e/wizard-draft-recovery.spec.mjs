import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createClinicalPatient(page) {
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(uniqueLabel('Recovery test mother'));
  await page.locator('[data-baby-field="name"]').first().fill(uniqueLabel('Recovery test baby'));
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(res => res.url().endsWith('/api/clinical/patients') && res.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  return response.json();
}

test('unsaved first-stage clinical form is encrypted and explicitly recoverable after a reload', async ({ page }) => {
  await login(page);
  await createClinicalPatient(page);
  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();

  const address = uniqueLabel('Unsent appointment address');
  await page.locator('[data-wizard-step="1"] [data-encounter-field="address"]').fill(address);
  await expect(page.locator('[data-wizard-backup-status]')).toContainText('Cópia criptografada');
  await page.reload();

  const dialog = page.locator('[data-wizard-recovery-dialog]');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-wizard-step="1"] [data-encounter-field="address"]')).not.toHaveValue(address);
  await dialog.locator('[data-wizard-restore]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-wizard-step="1"] [data-encounter-field="address"]')).toHaveValue(address);
});

test('failed wizard autosave is recoverable and does not silently overwrite the canonical SQL record', async ({ page }) => {
  await login(page);
  const patient = await createClinicalPatient(page);
  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="2"]')).toBeVisible();
  const encounterId = await page.locator('[data-screen="appointment"]').getAttribute('data-encounter-id');
  expect(encounterId).toBeTruthy();

  await page.route('**/api/clinical/records/clinical_encounters*', async route => {
    if (route.request().method() === 'PATCH') return route.abort('failed');
    return route.continue();
  });
  const complaint = uniqueLabel('Unsent consultation notes');
  await page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]').fill(complaint);
  await expect(page.locator('[data-wizard-backup-status]')).toContainText('Cópia criptografada');
  await page.goto('/app/#/patient/' + encodeURIComponent(patient.mother.id));

  await page.locator('[data-action="open-encounter"][data-encounter-id="' + encounterId + '"]').first().click();
  const dialog = page.locator('[data-wizard-recovery-dialog]');
  await expect(dialog).toBeVisible();

  const headers = await authHeaders(page);
  const readRecord = async () => {
    const response = await page.request.get('/api/clinical/records/clinical_encounters?id=eq.' + encodeURIComponent(encounterId) + '&limit=1', { headers });
    expect(response.ok()).toBeTruthy();
    return (await response.json())[0];
  };
  expect((await readRecord())?.chief_complaint?.notes).not.toBe(complaint);

  await dialog.locator('[data-wizard-restore]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]')).toHaveValue(complaint);
  expect((await readRecord())?.chief_complaint?.notes).not.toBe(complaint);
});
