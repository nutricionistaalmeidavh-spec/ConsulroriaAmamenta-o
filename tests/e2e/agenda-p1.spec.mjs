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

async function appointmentById(page, headers, id) {
  const response = await page.request.get(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(id)}&limit=1`, { headers });
  expect(response.ok()).toBeTruthy();
  return (await response.json())[0] ?? null;
}

test('agenda schedule, reschedule and encounter start survive reload without duplicate encounter', async ({ page }) => {
  await login(page);
  const patient = await createPatient(page);
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const label = uniqueLabel('Agenda P1');
  const firstStart = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const scheduled = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: firstStart,
      p_duration_min: 60,
      p_appointment_type: label,
      p_format: 'Domiciliar',
      p_value_cents: 15000,
      p_payment_status: 'Pendente',
    },
  });
  expect(scheduled.ok()).toBeTruthy();
  const appointment = await scheduled.json();
  expect(appointment.status).toBe('Agendado');

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target=agenda]:visible').first().click();
  await expect(page.locator('[data-agenda-live]')).toContainText(label);

  const secondStart = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
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
