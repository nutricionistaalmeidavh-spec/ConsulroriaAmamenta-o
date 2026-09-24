import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page) {
  const mother = uniqueLabel('Agenda mother');
  const baby = uniqueLabel('Agenda baby');
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
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2,'0')}:00:00-03:00`).toISOString();
}

async function appointmentById(page, headers, id) {
  const response = await page.request.get(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(id)}&limit=1`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json())[0] ?? null;
}

async function schedule(page, headers, patient, label, startsAt) {
  const response = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: startsAt,
      p_duration_min: 60,
      p_appointment_type: label,
      p_format: 'Domiciliar',
      p_value_cents: 15000,
      p_payment_status: 'Pendente',
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('agenda schedule, reschedule and encounter start survive reload without duplicate encounter', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const label = uniqueLabel('Agenda P1');
  const appointment = await schedule(page, headers, patient, label, clinicTodayAt(15));
  expect(appointment.status).toBe('Agendado');

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target=agenda]:visible').first().click();
  await expect(page.locator('[data-agenda-live]')).toContainText(label);

  const secondStart = clinicTodayAt(16);
  const rescheduled = await page.request.patch(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(appointment.id)}`, {
    headers,
    data: { starts_at: secondStart, status: 'Confirmado' },
  });
  expect(rescheduled.ok()).toBeTruthy();
  const afterReschedule = await appointmentById(page, headers, appointment.id);
  expect(afterReschedule.starts_at).toBe(secondStart);
  expect(afterReschedule.status).toBe('Confirmado');

  const firstStartEncounter = await page.request.post('/api/clinical/rpc/start_clinical_encounter_from_appointment', {
    headers,
    data: { p_appointment_id: appointment.id },
  });
  expect(firstStartEncounter.ok()).toBeTruthy();
  const firstIds = await firstStartEncounter.json();
  const retryStartEncounter = await page.request.post('/api/clinical/rpc/start_clinical_encounter_from_appointment', {
    headers,
    data: { p_appointment_id: appointment.id },
  });
  expect(retryStartEncounter.ok()).toBeTruthy();
  const retryIds = await retryStartEncounter.json();
  expect(retryIds.encounter_id).toBe(firstIds.encounter_id);

  const encounterResponse = await page.request.get(`/api/clinical/records/clinical_encounters?id=eq.${encodeURIComponent(firstIds.encounter_id)}&limit=1`, { headers });
  expect(encounterResponse.ok()).toBeTruthy();
  const encounter = (await encounterResponse.json())[0];
  expect(encounter.mother_id).toBe(patient.mother.id);
  expect(encounter.baby_id).toBe(patient.babies[0].id);
  expect(encounter.appointment_id).toBe(appointment.id);

  const finalAppointment = await appointmentById(page, headers, appointment.id);
  expect(finalAppointment.status).toBe('Em atendimento');

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  const persisted = await appointmentById(page, await authHeaders(page), appointment.id);
  expect(persisted.starts_at).toBe(secondStart);
  expect(persisted.status).toBe('Em atendimento');
});

test('cancelled appointment remains auditable but disappears from the home upcoming list', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const label = uniqueLabel('Cancelled agenda P1');
  const appointment = await schedule(page, headers, patient, label, clinicTodayAt(17));

  const cancelled = await page.request.patch(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(appointment.id)}`, {
    headers,
    data: { status: 'Cancelado' },
  });
  expect(cancelled.ok()).toBeTruthy();
  expect((await appointmentById(page, headers, appointment.id)).status).toBe('Cancelado');

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target=home]:visible').first().click();
  await expect(page.locator('[data-home-agenda-live]')).not.toContainText(label);
  await page.locator('[data-nav-target=agenda]:visible').first().click();
  await expect(page.locator('[data-agenda-live]')).toContainText(label);
  await expect(page.locator('[data-agenda-live]')).toContainText('Cancelado');
});
