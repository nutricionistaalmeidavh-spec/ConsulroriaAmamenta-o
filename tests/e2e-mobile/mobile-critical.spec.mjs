import { test, expect } from '../e2e/fixtures.mjs';
import { login, authHeaders, uniqueLabel } from '../e2e/helpers.mjs';

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

function clinicTodayAt(hour) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${String(hour).padStart(2, '0')}:00:00-03:00`).toISOString();
}

async function createPatientFromMobileUi(page) {
  const mother = uniqueLabel('Mobile mother');
  const baby = uniqueLabel('Mobile baby');
  await page.locator('[data-mobile-target=patients]:visible').click();
  await expect(page.locator('[data-screen=patients]')).toBeVisible();
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await expect(page.locator('[data-screen="patient-form"]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.locator('[name=motherName]').fill(mother);
  await page.locator('[data-baby-field="name"]').first().fill(baby);
  await page.locator('[name=consentData]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toContainText(mother);
  await expect(page).toHaveURL(/#\/patient\/(?!form)[^/]+/);
  await expectNoHorizontalOverflow(page);
  return { patient, mother, baby };
}

async function scheduleAppointment(page, headers, patient, label) {
  const response = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: clinicTodayAt(15),
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

test('mobile critical path supports login, patient, atendimento, agenda and logout without layout overflow', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  await login(page);
  await expect(page.locator('.lactation-bottom-nav')).toBeVisible();
  await expect(page.locator('.lactation-sidebar')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  const { patient } = await createPatientFromMobileUi(page);
  const headers = await authHeaders(page);
  const label = uniqueLabel(`Mobile ${testInfo.project.name}`);
  const appointment = await scheduleAppointment(page, headers, patient, label);

  await page.locator('.lactation-fab[data-action="new-appointment"]:visible').click();
  await expect(page.locator('[data-screen=appointment]')).toBeVisible();
  await expect(page.locator('[data-appointment-patient]')).toHaveValue(patient.mother.id);
  await expectNoHorizontalOverflow(page);
  await page.locator('[data-wizard-close]:visible').click();

  await page.locator('[data-mobile-target=agenda]:visible').click();
  await expect(page.locator('[data-screen=agenda]')).toBeVisible();
  await expect(page.locator('[data-agenda-live]')).toContainText(label);
  await expectNoHorizontalOverflow(page);

  const start = page.locator(`[data-action="start-scheduled-appointment"][data-appointment-id="${appointment.id}"]:visible`);
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.locator('[data-screen=appointment]')).toBeVisible();
  await expect(page.locator('[data-appointment-patient]')).toHaveValue(patient.mother.id);
  await expectNoHorizontalOverflow(page);
  await page.locator('[data-wizard-close]:visible').click();

  await page.locator('[data-mobile-target=more]:visible').click();
  await expect(page.locator('[data-screen=more]')).toBeVisible();
  await page.locator('[data-nav-target=settings]:visible').click();
  await expect(page.locator('[data-screen=settings]')).toBeVisible();
  await page.locator('[data-action=logout]:visible').click();
  await expect(page.locator('[data-login-form]')).toBeVisible();

  expect(errors).toEqual([]);
});
