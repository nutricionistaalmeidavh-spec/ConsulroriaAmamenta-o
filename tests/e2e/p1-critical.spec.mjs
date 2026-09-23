import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';
import { credentials } from '../helpers/cloudflare-local.mjs';

async function createPatientViaUi(page, prefix = 'P1') {
  const motherName = uniqueLabel(`${prefix} mother`);
  const babyName = uniqueLabel(`${prefix} baby`);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field=name]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
  return { ...patient, motherName, babyName };
}

async function rpc(page, name, data) {
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  return page.request.post(`/api/clinical/rpc/${name}`, { headers, data });
}

async function records(page, table, query = '') {
  const headers = await authHeaders(page);
  const suffix = query ? `?${query}` : '';
  const response = await page.request.get(`/api/clinical/records/${table}${suffix}`, { headers });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function startEncounter(page, patient, label = 'P1 synthetic') {
  const started = await rpc(page, 'start_clinical_encounter', {
    p_mother_id: patient.mother.id,
    p_baby_ids: [patient.babies[0].id],
    p_starts_at: new Date(Date.now() + 3600000).toISOString(),
    p_duration_min: 60,
    p_appointment_type: label,
    p_format: 'Domiciliar',
    p_value_cents: 0,
    p_payment_status: 'Pendente',
  });
  expect(started.ok()).toBeTruthy();
  return started.json();
}

async function createPackageThroughEncounter(page, patient, sessionsTotal = 2) {
  const ids = await startEncounter(page, patient, 'Plano P1');
  const configured = await rpc(page, 'set_appointment_billing', {
    p_appointment_id: ids.appointment_id,
    p_billing_mode: 'package_new',
    p_service_label: 'Plano P1',
    p_value_cents: 0,
    p_payment_method: 'Pix',
    p_package_total_cents: 50000,
    p_package_sessions_total: sessionsTotal,
    p_package_id: null,
  });
  expect(configured.ok()).toBeTruthy();
  const finalized = await rpc(page, 'finalize_encounter_billing', {
    p_appointment_id: ids.appointment_id,
    p_encounter_id: ids.encounter_id,
  });
  expect(finalized.ok()).toBeTruthy();
  return finalized.json();
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`;
}

async function recoveryToken(request, email) {
  const recover = await request.post('/api/auth/recovery', { data: { email } });
  expect(recover.ok()).toBeTruthy();
  const inbox = await (await request.get('http://127.0.0.1:4174/recovery-inbox')).json();
  const message = [...inbox].reverse().find(item => item.to === email);
  expect(message?.recoveryUrl).toBeTruthy();
  const link = new URL(message.recoveryUrl);
  return link.hash.slice('#recovery_token='.length);
}

test('agenda create, reschedule, reload and delete keep the appointment consistent in D1 and UI', async ({ page }) => {
  await login(page);
  const patient = await createPatientViaUi(page, 'Agenda');
  const startsAt = new Date(Date.now() + 2 * 86400000).toISOString();
  const scheduled = await rpc(page, 'schedule_clinical_appointment', {
    p_mother_id: patient.mother.id,
    p_baby_ids: [patient.babies[0].id],
    p_starts_at: startsAt,
    p_duration_min: 60,
    p_appointment_type: 'Retorno P1',
    p_format: 'Online',
    p_value_cents: 12000,
    p_payment_status: 'Pendente',
  });
  expect(scheduled.status()).toBe(200);
  const appointment = await scheduled.json();
  expect(appointment.id).toBeTruthy();

  const rescheduledAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const patch = await page.request.patch(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(appointment.id)}`, {
    headers,
    data: { starts_at: rescheduledAt, status: 'Confirmado' },
  });
  expect(patch.ok()).toBeTruthy();

  const rows = await records(page, 'appointments', `id=eq.${encodeURIComponent(appointment.id)}&limit=1`);
  expect(rows).toHaveLength(1);
  expect(rows[0].mother_id).toBe(patient.mother.id);
  expect(rows[0].starts_at).toBe(rescheduledAt);
  expect(rows[0].status).toBe('Confirmado');

  await page.reload();
  await page.locator('[data-nav-target=agenda]:visible').first().click();
  const card = page.locator(`[data-agenda-live] [data-appointment-id="${appointment.id}"]`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(patient.motherName);

  const deleted = await rpc(page, 'delete_scheduled_appointment', {
    p_appointment_id: appointment.id,
    p_confirmation: 'EXCLUIR',
  });
  expect(deleted.ok()).toBeTruthy();
  expect(await records(page, 'appointments', `id=eq.${encodeURIComponent(appointment.id)}&limit=1`)).toEqual([]);

  await page.reload();
  await page.locator('[data-nav-target=agenda]:visible').first().click();
  await expect(page.locator(`[data-agenda-live] [data-appointment-id="${appointment.id}"]`)).toHaveCount(0);
});

test('package lifecycle charges once, consumes sessions, completes and allows a fresh package', async ({ page }) => {
  await login(page);
  const patient = await createPatientViaUi(page, 'Package');
  const first = await createPackageThroughEncounter(page, patient, 2);
  expect(first.billing_mode).toBe('package_new');
  expect(first.package_id).toBeTruthy();
  expect(first.sessions_used).toBe(1);
  expect(first.sessions_remaining).toBe(1);

  const secondIds = await startEncounter(page, patient, 'Plano P1 retorno');
  const useExisting = await rpc(page, 'set_appointment_billing', {
    p_appointment_id: secondIds.appointment_id,
    p_billing_mode: 'package_active',
    p_service_label: 'Plano P1',
    p_value_cents: 0,
    p_payment_method: 'Pix',
    p_package_total_cents: null,
    p_package_sessions_total: null,
    p_package_id: first.package_id,
  });
  expect(useExisting.ok()).toBeTruthy();
  const second = await rpc(page, 'finalize_encounter_billing', {
    p_appointment_id: secondIds.appointment_id,
    p_encounter_id: secondIds.encounter_id,
  });
  expect(second.ok()).toBeTruthy();
  const secondBody = await second.json();
  expect(secondBody.package_id).toBe(first.package_id);
  expect(secondBody.sessions_used).toBe(2);
  expect(secondBody.sessions_remaining).toBe(0);
  expect(secondBody.package_status).toBe('completed');

  const packageRows = await records(page, 'care_packages', `id=eq.${encodeURIComponent(first.package_id)}&limit=1`);
  expect(packageRows).toHaveLength(1);
  expect(packageRows[0].status).toBe('completed');
  const charges = await records(page, 'financial_entries', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  expect(charges.filter(row => row.package_id === first.package_id)).toHaveLength(1);

  const third = await createPackageThroughEncounter(page, patient, 3);
  expect(third.package_id).toBeTruthy();
  expect(third.package_id).not.toBe(first.package_id);
  expect(third.sessions_used).toBe(1);
  expect(third.sessions_remaining).toBe(2);
});

test('expired recovery tokens are rejected and late D1 failures roll back so the same token can retry', async ({ request }) => {
  const expiredEmail = uniqueEmail('expired-recovery');
  expect((await request.post('/api/auth/signup', { data: { email: expiredEmail, password: credentials.password } })).ok()).toBeTruthy();
  const expiredToken = await recoveryToken(request, expiredEmail);
  const expired = await request.post('http://127.0.0.1:4174/control/expire-recovery', { data: { email: expiredEmail } });
  expect(expired.ok()).toBeTruthy();
  expect((await expired.json()).changed).toBe(1);
  expect((await request.post('/api/auth/reset-password', { data: { token: expiredToken, password: 'Expired-should-not-work-2026!' } })).status()).toBe(400);

  const retryEmail = uniqueEmail('rollback-recovery');
  expect((await request.post('/api/auth/signup', { data: { email: retryEmail, password: credentials.password } })).ok()).toBeTruthy();
  const retryToken = await recoveryToken(request, retryEmail);
  expect((await request.post('http://127.0.0.1:4174/control/fail-recovery-persist', { data: { enabled: true } })).ok()).toBeTruthy();
  try {
    const failed = await request.post('/api/auth/reset-password', { data: { token: retryToken, password: 'Rollback-new-password-2026!' } });
    expect(failed.status()).toBe(503);
  } finally {
    expect((await request.post('http://127.0.0.1:4174/control/fail-recovery-persist', { data: { enabled: false } })).ok()).toBeTruthy();
  }
  expect((await request.post('/api/auth/token?grant_type=password', { data: { email: retryEmail, password: credentials.password } })).status()).toBe(200);
  expect((await request.post('/api/auth/reset-password', { data: { token: retryToken, password: 'Rollback-new-password-2026!' } })).status()).toBe(200);
  expect((await request.post('/api/auth/token?grant_type=password', { data: { email: retryEmail, password: 'Rollback-new-password-2026!' } })).status()).toBe(200);
});

test('only one concurrent password reset can claim the same recovery token', async ({ request }) => {
  const email = uniqueEmail('concurrent-recovery');
  expect((await request.post('/api/auth/signup', { data: { email, password: credentials.password } })).ok()).toBeTruthy();
  const token = await recoveryToken(request, email);
  const passwords = ['Concurrent-A-2026!', 'Concurrent-B-2026!'];
  const responses = await Promise.all(passwords.map(password => request.post('/api/auth/reset-password', { data: { token, password } })));
  expect(responses.map(r => r.status()).sort()).toEqual([200, 400]);
  const logins = await Promise.all(passwords.map(password => request.post('/api/auth/token?grant_type=password', { data: { email, password } })));
  expect(logins.filter(r => r.status() === 200)).toHaveLength(1);
});

test('two concurrent attempts cannot consume the single remaining package session twice', async ({ page }) => {
  await login(page);
  const patient = await createPatientViaUi(page, 'Concurrency');
  const pkg = await createPackageThroughEncounter(page, patient, 2);
  expect(pkg.sessions_remaining).toBe(1);

  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const bodies = ['A', 'B'].map(suffix => ({
    p_package_id: pkg.package_id,
    p_request_key: `p1-concurrent-${suffix}-${crypto.randomUUID()}`,
    p_notes: `P1 concurrent ${suffix}`,
  }));
  const responses = await Promise.all(bodies.map(data => page.request.post('/api/clinical/rpc/consume_care_package_session_manual', { headers, data })));
  expect(responses.map(r => r.status()).sort()).toEqual([200, 409]);

  const packages = await records(page, 'care_packages', `id=eq.${encodeURIComponent(pkg.package_id)}&limit=1`);
  expect(packages).toHaveLength(1);
  expect(packages[0].sessions_used).toBe(2);
  expect(packages[0].status).toBe('completed');
  const sessions = await records(page, 'care_package_sessions', `package_id=eq.${encodeURIComponent(pkg.package_id)}`);
  expect(sessions).toHaveLength(2);
});

test('PWA activation deletes old caches and an online reload replaces stale cached app HTML', async ({ page }) => {
  await page.goto('/app/');
  await page.waitForLoadState('load');
  const supported = await page.evaluate(() => 'serviceWorker' in navigator && 'caches' in window);
  expect(supported).toBeTruthy();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));

  await page.evaluate(async () => {
    const stale = await caches.open('debora-lactacao-vstale-p1-e2e');
    await stale.put('/app/', new Response('<html><body>STALE_P1_MARKER</body></html>', { headers: { 'content-type': 'text/html' } }));
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(registration => registration.unregister()));
  });

  await page.reload({ waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect(page.locator('[data-login-form]')).toBeVisible();
  const afterActivation = await page.evaluate(() => caches.keys());
  expect(afterActivation).not.toContain('debora-lactacao-vstale-p1-e2e');

  await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('debora-lactacao-v'));
    if (!names.length) throw new Error('Current PWA cache not found');
    const cache = await caches.open(names[0]);
    await cache.put('/app/', new Response('<html><body>STALE_P1_MARKER</body></html>', { headers: { 'content-type': 'text/html' } }));
  });
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('[data-login-form]')).toBeVisible();
  await page.waitForTimeout(300);
  const cachedHtml = await page.evaluate(async () => {
    const names = (await caches.keys()).filter(name => name.startsWith('debora-lactacao-v'));
    const cache = await caches.open(names[0]);
    return (await (await cache.match('/app/'))?.text()) || '';
  });
  expect(cachedHtml).not.toContain('STALE_P1_MARKER');
  expect(cachedHtml).toContain('data-login-form');
});
