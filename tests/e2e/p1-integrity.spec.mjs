import { test, expect } from './fixtures.mjs';
import { login, authHeaders, session, uniqueLabel } from './helpers.mjs';

async function createPatient(page, prefix = 'P1 patient') {
  const mother = uniqueLabel(`${prefix} mother`);
  const baby = uniqueLabel(`${prefix} baby`);
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

function clinicTodayAt(hour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();
}

async function schedule(page, patient, hour = 14) {
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const response = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: clinicTodayAt(hour),
      p_duration_min: 60,
      p_appointment_type: uniqueLabel('P1 appointment'),
      p_format: 'Domiciliar',
      p_value_cents: 15000,
      p_payment_status: 'Pendente',
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function records(page, table, query = '') {
  const response = await page.request.get(`/api/clinical/records/${table}${query ? `?${query}` : ''}`, { headers: await authHeaders(page) });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function startEncounter(page, appointmentId) {
  const response = await page.request.post('/api/clinical/rpc/start_clinical_encounter_from_appointment', {
    headers: { ...(await authHeaders(page)), 'content-type': 'application/json' },
    data: { p_appointment_id: appointmentId },
  });
  return response;
}

async function waitForFeatureModules(page) {
  await page.waitForFunction(() => Boolean(
    window.DeboraDocuments?.rest
    && window.DeboraBilling?.remountPlan
    && window.DeboraClinicalNote?.openEncounter
  ));
}

async function poisonAccessToken(page) {
  await page.evaluate(() => {
    const key = 'debora-lactacao-session';
    const value = JSON.parse(localStorage.getItem(key));
    value.access_token = 'expired.synthetic.token';
    for (const store of [localStorage, sessionStorage]) {
      for (const alias of [key, 'amamentacao-session', 'commercial.saas.session.v1']) {
        store.setItem(alias, JSON.stringify(value));
      }
      store.setItem('debora-runtime-access-token', value.access_token);
    }
    window.__deboraAccessToken = value.access_token;
  });
}

test('starting an encounter is atomic when the final appointment write fails', async ({ page, request }) => {
  await login(page);
  const patient = await createPatient(page, 'Atomic start');
  const appointment = await schedule(page, patient, 14);

  const enable = await request.post('http://127.0.0.1:4174/control/fail-encounter-start', { data: { enabled: true } });
  expect(enable.ok()).toBeTruthy();
  try {
    const failed = await startEncounter(page, appointment.id);
    expect(failed.ok()).toBeFalsy();
  } finally {
    const disable = await request.post('http://127.0.0.1:4174/control/fail-encounter-start', { data: { enabled: false } });
    expect(disable.ok()).toBeTruthy();
  }

  const appointments = await records(page, 'appointments', `id=eq.${encodeURIComponent(appointment.id)}&limit=1`);
  expect(appointments[0]?.status).toBe('Agendado');
  const afterFailure = await records(page, 'clinical_encounters', `appointment_id=eq.${encodeURIComponent(appointment.id)}`);
  expect(afterFailure).toEqual([]);

  const retry = await startEncounter(page, appointment.id);
  expect(retry.ok()).toBeTruthy();
  const retryBody = await retry.json();
  const afterRetry = await records(page, 'clinical_encounters', `appointment_id=eq.${encodeURIComponent(appointment.id)}`);
  expect(afterRetry).toHaveLength(1);
  expect(afterRetry[0].id).toBe(retryBody.encounter_id);
  const healedAppointment = await records(page, 'appointments', `id=eq.${encodeURIComponent(appointment.id)}&limit=1`);
  expect(healedAppointment[0]?.status).toBe('Em atendimento');
});

for (const scenario of [
  { name: 'terms', pattern: '**/api/clinical/records/consents?*' },
  { name: 'referrals', pattern: '**/api/clinical/records/clinical_documents?*' },
]) {
  test(`${scenario.name} read failure is shown as an error, never as an empty record count`, async ({ page }) => {
    await login(page);
    await createPatient(page, `Read failure ${scenario.name}`);
    await waitForFeatureModules(page);
    await expect(page.locator('[data-prh-card]')).toBeVisible();
    await page.route(scenario.pattern, route => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: `synthetic ${scenario.name} read failure` }),
    }));
    await page.evaluate(() => {
      document.querySelector('[data-prh-card]')?.remove();
      window.DeboraPatientRecordsHub?.refresh?.();
    });
    await expect(page.locator('#dui-toast-region .dui-toast')).toContainText(`synthetic ${scenario.name} read failure`);
    await expect(page.locator('[data-prh-card]')).toHaveCount(0);
  });
}

test('clinical note auxiliary read failure does not masquerade as an empty prontuario', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page, 'Prontuario read failure');
  const appointment = await schedule(page, patient, 15);
  const started = await startEncounter(page, appointment.id);
  expect(started.ok()).toBeTruthy();
  const { encounter_id: encounterId } = await started.json();
  await waitForFeatureModules(page);

  await page.route('**/api/clinical/records/clinical_encounter_addenda?*', route => route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'synthetic prontuario read failure' }),
  }));

  const result = await page.evaluate(async id => {
    try {
      await window.DeboraClinicalNote.openEncounter(id);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }, encounterId);
  expect(result.ok).toBeFalsy();
  expect(result.message).toContain('synthetic prontuario read failure');
  await expect(page.locator('#cn-overlay')).toHaveCount(0);
});

test('documents, billing and clinical note share the canonical 401 refresh path', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page, 'Shared auth');
  const appointment = await schedule(page, patient, 16);
  const started = await startEncounter(page, appointment.id);
  expect(started.ok()).toBeTruthy();
  const { encounter_id: encounterId } = await started.json();
  await waitForFeatureModules(page);

  await poisonAccessToken(page);
  const docs = await page.evaluate(async motherId => window.DeboraDocuments.consents(motherId), patient.mother.id);
  expect(Array.isArray(docs)).toBeTruthy();
  expect((await session(page)).access_token).not.toBe('expired.synthetic.token');

  await poisonAccessToken(page);
  await page.evaluate(async () => window.DeboraBilling.remountPlan());
  expect((await session(page)).access_token).not.toBe('expired.synthetic.token');

  await poisonAccessToken(page);
  const noteOpened = await page.evaluate(async id => {
    await window.DeboraClinicalNote.openEncounter(id);
    return Boolean(document.querySelector('#cn-overlay'));
  }, encounterId);
  expect(noteOpened).toBeTruthy();
  expect((await session(page)).access_token).not.toBe('expired.synthetic.token');
});

test('two tabs racing one refresh token both recover while the backend rotates it only once', async ({ page, context, request }) => {
  await login(page);
  await waitForFeatureModules(page);
  const beforeSession = await session(page);
  const email = beforeSession?.user?.email;
  expect(email).toBeTruthy();
  const beforeStats = await request.post('http://127.0.0.1:4174/control/auth-refresh-stats', { data: { email } });
  expect(beforeStats.ok()).toBeTruthy();
  const baselineActive = (await beforeStats.json()).active;

  const second = await context.newPage();
  await second.goto('/app/');
  await expect(second.locator('[data-app-root]')).toBeVisible();
  await waitForFeatureModules(second);
  await poisonAccessToken(page);
  await poisonAccessToken(second);

  const [firstResult, secondResult] = await Promise.all([
    page.evaluate(async () => window.DeboraDocuments.rest('mothers?select=id&limit=1')),
    second.evaluate(async () => window.DeboraDocuments.rest('mothers?select=id&limit=1')),
  ]);
  expect(Array.isArray(firstResult)).toBeTruthy();
  expect(Array.isArray(secondResult)).toBeTruthy();

  const finalSession = await session(page);
  expect(finalSession?.access_token).toBeTruthy();
  expect(finalSession.access_token).not.toBe('expired.synthetic.token');
  const afterStats = await request.post('http://127.0.0.1:4174/control/auth-refresh-stats', { data: { email } });
  expect(afterStats.ok()).toBeTruthy();
  expect((await afterStats.json()).active).toBe(baselineActive);
});
