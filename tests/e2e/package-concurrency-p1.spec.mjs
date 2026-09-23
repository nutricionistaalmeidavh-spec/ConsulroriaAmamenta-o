import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const mother = uniqueLabel('Package mother');
  const baby = uniqueLabel('Package baby');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(mother);
  await page.locator('[data-baby-field="name"]').first().fill(baby);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  return response.json();
}

async function records(page, headers, table, query = '') {
  const response = await page.request.get(`/api/clinical/records/${table}${query ? `?${query}` : ''}`, { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function createPackage(page, headers, patient, sessionsTotal, label = 'Pacote P1') {
  const appointmentResponse = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: new Date(Date.now() + 3600000).toISOString(),
      p_duration_min: 60,
      p_appointment_type: `${label} appointment`,
      p_format: 'Domiciliar',
      p_value_cents: 20000,
      p_payment_status: 'Pendente',
    },
  });
  expect(appointmentResponse.ok()).toBeTruthy();
  const appointment = await appointmentResponse.json();
  const billingResponse = await page.request.post('/api/clinical/rpc/set_appointment_billing', {
    headers,
    data: {
      p_appointment_id: appointment.id,
      p_billing_mode: 'package_new',
      p_service_label: label,
      p_value_cents: sessionsTotal * 20000,
      p_payment_method: 'Pix',
      p_package_total_cents: sessionsTotal * 20000,
      p_package_sessions_total: sessionsTotal,
      p_package_id: null,
    },
  });
  expect(billingResponse.ok()).toBeTruthy();
  const packages = await records(page, headers, 'care_packages', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  const usable = packages.filter(pkg => pkg.status === 'active' && Number(pkg.sessions_used) < Number(pkg.sessions_total));
  expect(usable).toHaveLength(1);
  return usable[0];
}

function consume(page, headers, packageId, requestKey) {
  return page.request.post('/api/clinical/rpc/consume_care_package_session_manual', {
    headers,
    data: { p_package_id: packageId, p_notes: 'P1 concurrent consumption', p_request_key: requestKey },
  });
}

test('package creation and same-key concurrent retries never double-consume and a fresh package can follow exhaustion', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const pkg = await createPackage(page, headers, patient, 2);
  expect(pkg.sessions_total).toBe(2);
  expect(pkg.sessions_used).toBe(0);

  const firstKey = crypto.randomUUID();
  const [sameA, sameB] = await Promise.all([
    consume(page, headers, pkg.id, firstKey),
    consume(page, headers, pkg.id, firstKey),
  ]);
  expect(sameA.ok()).toBeTruthy();
  expect(sameB.ok()).toBeTruthy();
  const samePayloads = await Promise.all([sameA.json(), sameB.json()]);
  expect(samePayloads.filter(row => row.idempotent === false)).toHaveLength(1);
  expect(samePayloads.filter(row => row.idempotent === true)).toHaveLength(1);

  let sessions = await records(page, headers, 'care_package_sessions', `package_id=eq.${encodeURIComponent(pkg.id)}`);
  expect(sessions).toHaveLength(1);
  let refreshed = (await records(page, headers, 'care_packages', `id=eq.${encodeURIComponent(pkg.id)}&limit=1`))[0];
  expect(refreshed.sessions_used).toBe(1);
  expect(refreshed.status).toBe('active');

  const secondKey = crypto.randomUUID();
  const second = await consume(page, headers, pkg.id, secondKey);
  expect(second.ok()).toBeTruthy();
  const secondPayload = await second.json();
  expect(secondPayload.sessions_used).toBe(2);
  expect(secondPayload.sessions_remaining).toBe(0);
  expect(secondPayload.package_status).toBe('completed');

  const retryOld = await consume(page, headers, pkg.id, firstKey);
  expect(retryOld.ok()).toBeTruthy();
  expect((await retryOld.json()).idempotent).toBe(true);

  sessions = await records(page, headers, 'care_package_sessions', `package_id=eq.${encodeURIComponent(pkg.id)}`);
  expect(sessions).toHaveLength(2);
  refreshed = (await records(page, headers, 'care_packages', `id=eq.${encodeURIComponent(pkg.id)}&limit=1`))[0];
  expect(refreshed.sessions_used).toBe(2);
  expect(refreshed.status).toBe('completed');

  const fresh = await createPackage(page, headers, patient, 3, 'Pacote P1 renovado');
  expect(fresh.id).not.toBe(pkg.id);
  expect(fresh.sessions_total).toBe(3);
  expect(fresh.sessions_used).toBe(0);
  const allPackages = await records(page, headers, 'care_packages', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  expect(allPackages.filter(row => row.status === 'active' && Number(row.sessions_used) < Number(row.sessions_total))).toHaveLength(1);

  const financial = await records(page, headers, 'financial_entries', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  const packageCharges = financial.filter(row => Number(row.amount_cents || 0) > 0);
  expect(packageCharges.length).toBeLessThanOrEqual(2);
});

test('two distinct requests racing for one remaining package session cannot both consume it', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const pkg = await createPackage(page, headers, patient, 1, 'Pacote corrida P1');

  const [a, b] = await Promise.all([
    consume(page, headers, pkg.id, crypto.randomUUID()),
    consume(page, headers, pkg.id, crypto.randomUUID()),
  ]);
  expect([a.status(), b.status()].sort((x,y) => x-y)).toEqual([200, 409]);

  const refreshed = (await records(page, headers, 'care_packages', `id=eq.${encodeURIComponent(pkg.id)}&limit=1`))[0];
  expect(refreshed.sessions_used).toBe(1);
  expect(refreshed.status).toBe('completed');
  const sessions = await records(page, headers, 'care_package_sessions', `package_id=eq.${encodeURIComponent(pkg.id)}`);
  expect(sessions).toHaveLength(1);
});
