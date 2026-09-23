import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const mother = uniqueLabel('Concurrent mother');
  const baby = uniqueLabel('Concurrent baby');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(mother);
  await page.locator('[data-baby-field="name"]').first().fill(baby);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toContainText(baby);
  await expect(page).toHaveURL(new RegExp(`#\\/patient\\/${patient.mother.id}$`));
  return { patient, mother, baby };
}

test('two tabs may be last-write-wins for distinct edits but never partially corrupt the patient aggregate', async ({ page }) => {
  await login(page);
  const { patient, baby } = await createPatient(page);
  const patientUrl = page.url();
  const second = await page.context().newPage();
  await second.goto(patientUrl);
  await expect(second.locator('[data-app-root]')).toBeVisible();
  await expect(second.locator('[data-patient-title]')).toContainText(baby);

  await page.locator('[data-action=edit-patient]:visible').first().click();
  await second.locator('[data-action=edit-patient]:visible').first().click();

  const nameA = uniqueLabel('Tab A');
  const nameB = uniqueLabel('Tab B');
  await page.locator('[name=motherName]').fill(nameA);
  await second.locator('[name=motherName]').fill(nameB);

  const responseA = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
  const responseB = second.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'PATCH');
  await Promise.all([
    page.locator('[data-patient-form] button[type=submit]:visible').first().click(),
    second.locator('[data-patient-form] button[type=submit]:visible').first().click(),
  ]);
  expect((await responseA).status()).toBe(200);
  expect((await responseB).status()).toBe(200);

  const headers = await authHeaders(page);
  const motherResponse = await page.request.get(`/api/clinical/records/mothers?id=eq.${encodeURIComponent(patient.mother.id)}&limit=1`, { headers });
  expect(motherResponse.ok()).toBeTruthy();
  const finalMother = (await motherResponse.json())[0];
  expect([nameA, nameB]).toContain(finalMother.name);

  const babyResponse = await page.request.get(`/api/clinical/records/babies?id=eq.${encodeURIComponent(patient.babies[0].id)}&limit=1`, { headers });
  expect(babyResponse.ok()).toBeTruthy();
  const finalBaby = (await babyResponse.json())[0];
  expect(finalBaby.name).toBe(baby);
  expect(finalBaby.mother_id).toBe(patient.mother.id);

  await page.goto(patientUrl);
  await expect(page.locator('[data-patient-title]')).toContainText(finalMother.name);
  await expect(page.locator('[data-patient-title]')).toContainText(baby);
  await second.close();
});
