import { test, expect } from './fixtures.mjs';
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
  return response.json();
}

async function clearBrowserSession(page) {
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function createRecord(page, headers, table, body) {
  const response = await page.request.post(`/api/clinical/records/${table}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: body,
  });
  expect(response.status()).toBe(201);
  return (await response.json())[0];
}

test('a second professional cannot list, read or edit another professional patient', async ({ page }) => {
  const originalName = uniqueLabel('Owner A mother');
  await login(page);
  const patient = await createPatient(page, originalName, uniqueLabel('Owner A baby'));
  const motherId = patient.mother.id;

  await clearBrowserSession(page);
  await login(page, 'other@example.test');
  const otherHeaders = await authHeaders(page);

  const list = await page.request.get(`/api/clinical/records/mothers?id=eq.${encodeURIComponent(motherId)}&limit=1`, { headers: otherHeaders });
  expect(list.ok()).toBeTruthy();
  expect(await list.json()).toEqual([]);

  const edit = await page.request.patch('/api/clinical/patients', {
    headers: { ...otherHeaders, 'content-type': 'application/json' },
    data: { mother: { id: motherId, name: 'Cross-user hijack must fail' } },
  });
  expect([403, 404]).toContain(edit.status());

  await clearBrowserSession(page);
  await login(page);
  const ownerHeaders = await authHeaders(page);
  const ownerRead = await page.request.get(`/api/clinical/records/mothers?id=eq.${encodeURIComponent(motherId)}&limit=1`, { headers: ownerHeaders });
  expect(ownerRead.ok()).toBeTruthy();
  const rows = await ownerRead.json();
  expect(rows).toHaveLength(1);
  expect(rows[0].name).toBe(originalName);
});

test('owned record writes reject foreign parents and cross-account relationship links', async ({ page }) => {
  await login(page);
  const ownerA = await createPatient(page, uniqueLabel('Owner A relation mother'), uniqueLabel('Owner A relation baby'));
  const ownerAHeaders = await authHeaders(page);
  const ownerAAppointment = await createRecord(page, ownerAHeaders, 'appointments', {
    mother_id: ownerA.mother.id,
    starts_at: '2026-09-25T16:00:00.000Z',
    status: 'Agendado',
    appointment_type: 'Retorno',
  });

  await clearBrowserSession(page);
  await login(page, 'other@example.test');
  const ownerB = await createPatient(page, uniqueLabel('Owner B relation mother'), uniqueLabel('Owner B relation baby'));
  const ownerBHeaders = await authHeaders(page);

  const foreignParent = await page.request.post('/api/clinical/records/appointments', {
    headers: { ...ownerBHeaders, 'content-type': 'application/json' },
    data: {
      mother_id: ownerA.mother.id,
      starts_at: '2026-09-25T17:00:00.000Z',
      status: 'Agendado',
      appointment_type: 'Retorno',
    },
  });
  expect(foreignParent.status()).toBe(403);

  const crossAccountLink = await page.request.post('/api/clinical/records/appointment_babies', {
    headers: { ...ownerBHeaders, 'content-type': 'application/json' },
    data: { appointment_id: ownerAAppointment.id, baby_id: ownerB.babies[0].id, is_primary: true },
  });
  expect(crossAccountLink.status()).toBe(405);
  expect(await crossAccountLink.json()).toMatchObject({ error: 'generic_mutation_not_allowed', table: 'appointment_babies' });
});