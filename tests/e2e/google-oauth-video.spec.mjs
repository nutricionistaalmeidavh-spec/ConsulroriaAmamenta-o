import { mkdir } from 'node:fs/promises';
import { test, expect } from './fixtures.mjs';
import { login, authHeaders } from './helpers.mjs';

// Real Chromium recording of the clinical UI with synthetic patient data.
// This intentionally does NOT fake Google's OAuth consent or claim verification.
test('record real QA demo of Gestão Amamentação and Google integration settings', async ({ page }) => {
  test.setTimeout(120_000);
  const slow = async (ms = 1700) => page.waitForTimeout(ms);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/comercial/');
  await expect(page.locator('body')).toContainText('Gestão');
  await slow(2300);

  await login(page);
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await slow(2200);

  // Real patient creation via frontend, not a screenshot mock.
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await slow(900);
  await page.locator('[name=motherName]').fill('Mariana Costa (FICTÍCIA)');
  await page.locator('[data-baby-field="name"]').first().fill('Lívia Costa (FICTÍCIA)');
  await page.locator('[name=consentData]').check();
  await slow(1900);
  const patientResponse = page.waitForResponse(r =>
    r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const result = await patientResponse;
  expect(result.status()).toBe(201);
  const patient = await result.json();
  await expect(page.locator('[data-patient-title]')).toContainText('Mariana Costa');
  await slow(2200);

  // Schedule an appointment in the authentic local Cloudflare/D1 QA runtime.
  const starts = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const headers = { ...(await authHeaders(page)), 'content-type': 'application/json' };
  const appointment = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers,
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: starts,
      p_duration_min: 60,
      p_appointment_type: 'Acompanhamento (FICTÍCIO)',
      p_format: 'Online',
      p_value_cents: 0,
      p_payment_status: 'Pendente',
    },
  });
  expect(appointment.ok()).toBeTruthy();

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target="agenda"]:visible').first().click();
  await expect(page.locator('[data-screen=agenda]')).toBeVisible();
  await slow(4500);

  await page.locator('[data-nav-target=settings]:visible').first().click();
  await expect(page.locator('[data-screen=settings]')).toBeVisible();
  await expect(page.locator('[data-calendar-integrations]')).toBeVisible();
  await slow(4200);

  // Cannot record actual Google consent without a live OAuth test project and
  // a human-owned Google account. Video clearly remains a PARTIAL QA demo.
  await mkdir('artifacts/google-calendar-qa-video', { recursive: true });
  await page.screenshot({ path: 'artifacts/google-calendar-qa-video/google-integration-settings.png', fullPage: true });
  await page.close();
  const video = page.video();
  if (!video) throw new Error('Video recording disabled.');
  await video.saveAs('artifacts/google-calendar-qa-video/clinical-demo-real-ui.webm');
});
