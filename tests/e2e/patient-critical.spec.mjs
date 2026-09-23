import { test, expect } from '@playwright/test';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page, motherName, babyName) {
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
  return patient;
}

async function record(page, table, id) {
  const headers = await authHeaders(page);
  const response = await page.request.get(`/api/clinical/records/${table}?id=eq.${encodeURIComponent(id)}&limit=1`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json())[0] ?? null;
}

test('successful aggregate edit persists mother and baby across reload', async ({ page }) => {
  await login(page);
  const motherName = uniqueLabel('Atomic mother');
  const babyName = uniqueLabel('Atomic baby');
  const patient = await createPatient(page, motherName, babyName);

  await page.locator('[data-action=edit-patient]:visible').first().click();
  const changedMother = `${motherName}-edited`;
  const changedBaby = `${babyName}-edited`;
  await page.locator('[name=motherName]').fill(changedMother);
  await page.locator('[data-baby-field="name"]').first().fill(changedBaby);
  await page.locator('[name=consentWhatsapp]').check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('[data-patient-title]')).toHaveText(`${changedMother} + ${changedBaby}`);
  const detailUrl = page.url();

  await page.reload();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${changedMother} + ${changedBaby}`);
  expect((await record(page, 'mothers', patient.mother.id)).name).toBe(changedMother);
  expect((await record(page, 'babies', patient.babies[0].id)).name).toBe(changedBaby);
  expect(page.url()).toBe(detailUrl);
});

test('late consent failure rolls back mother and baby edits as one aggregate', async ({ page, request }) => {
  await login(page);
  const motherName = uniqueLabel('Rollback mother');
  const babyName = uniqueLabel('Rollback baby');
  const patient = await createPatient(page, motherName, babyName);
  const detailUrl = page.url();

  const enable = await request.post('http://127.0.0.1:4174/control/fail-patient-consent', { data: { enabled: true } });
  expect(enable.ok()).toBeTruthy();
  try {
    await page.locator('[data-action=edit-patient]:visible').first().click();
    await page.locator('[name=motherName]').fill(`${motherName}-must-not-stick`);
    await page.locator('[data-baby-field="name"]').first().fill(`${babyName}-must-not-stick`);
    await page.locator('[name=consentData]').uncheck();
    const failed = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
    await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
    expect((await failed).status()).toBe(500);
  } finally {
    const disable = await request.post('http://127.0.0.1:4174/control/fail-patient-consent', { data: { enabled: false } });
    expect(disable.ok()).toBeTruthy();
  }

  expect((await record(page, 'mothers', patient.mother.id)).name).toBe(motherName);
  expect((await record(page, 'babies', patient.babies[0].id)).name).toBe(babyName);
  await page.goto(detailUrl);
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
});
