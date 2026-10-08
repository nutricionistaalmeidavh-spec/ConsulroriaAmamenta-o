import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(page, headers) {
  const motherName = uniqueLabel('Quick actions mother');
  const babyName = uniqueLabel('Quick actions baby');
  const response = await page.request.post('/api/clinical/patients', {
    headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': uniqueLabel('quick-actions-patient') },
    data: {
      mother: { name: motherName, phone: '16999998888' },
      babies: [{ name: babyName, birth_weight_g: 3200, current_weight_g: 3300 }],
      consents: { data_processing: true, whatsapp: true, clinical_media: true },
    },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()), motherName, babyName };
}

async function schedule(page, headers, patient, startsAt, address, format = 'Domiciliar') {
  const response = await page.request.post('/api/clinical/rpc/schedule_clinical_appointment', {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: startsAt,
      p_duration_min: 60,
      p_appointment_type: 'Retorno',
      p_format: format,
      p_value_cents: 15000,
      p_payment_status: 'Pendente',
      p_address: address,
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('patient quick actions remain canonical after workspace enhancement and execute their own flows', async ({ page }) => {
  await login(page);
  const headers = await authHeaders(page);
  const patient = await createPatient(page, headers);

  const cancelledAddress = 'Rua Cancelada, 10';
  const activeAddress = 'Rua Correta, 20';
  const cancelled = await schedule(page, headers, patient, new Date(Date.now() + 60 * 60 * 1000).toISOString(), cancelledAddress);
  const cancelledPatch = await page.request.patch(`/api/clinical/records/appointments?id=eq.${encodeURIComponent(cancelled.id)}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { status: 'Cancelado' },
  });
  expect(cancelledPatch.ok()).toBeTruthy();
  await schedule(page, headers, patient, new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), activeAddress);

  await page.reload();
  await page.goto(`/app/#/patient/${patient.mother.id}`);
  await expect(page.locator('[data-patient-title]')).toContainText(patient.motherName);
  await page.waitForFunction(() => Boolean(window.DeboraPatientWorkspace && window.DeboraAlbum));

  const quick = page.locator('.patient-quick');
  await expect(quick.locator('button')).toHaveText(['WhatsApp', 'Ligar', 'Rota', 'Registrar peso', 'Adicionar foto']);
  await page.evaluate(() => window.DeboraPatientWorkspace.refresh());
  await page.waitForTimeout(350);
  await expect(quick.locator('button')).toHaveText(['WhatsApp', 'Ligar', 'Rota', 'Registrar peso', 'Adicionar foto']);
  for (const action of ['patient-whatsapp', 'patient-call', 'patient-route', 'add-weight', 'patient-add-media']) {
    await expect(quick.locator(`[data-action="${action}"]`)).toBeVisible();
  }

  await page.evaluate(() => {
    window.__quickActionOpens = [];
    window.open = (url, target, features) => {
      window.__quickActionOpens.push({ url: String(url), target: target || '', features: features || '' });
      return null;
    };
  });

  await quick.locator('[data-action="patient-whatsapp"]').click();
  await expect.poll(() => page.evaluate(() => window.__quickActionOpens.at(-1)?.url || '')).toBe('https://wa.me/5516999998888');

  await quick.locator('[data-action="patient-call"]').click();
  await expect.poll(() => page.evaluate(() => window.__quickActionOpens.at(-1)?.url || '')).toBe('tel:+5516999998888');
  expect(await page.evaluate(() => window.__quickActionOpens.at(-1)?.target)).toBe('_self');

  await quick.locator('[data-action="patient-route"]').click();
  const routeUrl = await expect.poll(() => page.evaluate(() => window.__quickActionOpens.at(-1)?.url || '')).toContain('https://www.google.com/maps/search/?api=1&query=');
  const lastRoute = await page.evaluate(() => window.__quickActionOpens.at(-1)?.url || '');
  expect(decodeURIComponent(lastRoute)).toContain(activeAddress);
  expect(decodeURIComponent(lastRoute)).not.toContain(cancelledAddress);

  await page.waitForFunction(() => Boolean(window.DeboraWeightCorrection?.openNew));
  await quick.locator('[data-action="add-weight"]').click();
  await expect(page.locator('#wc-dialog')).toBeVisible();
  await page.locator('[data-wc-weight]').fill('3456');
  await page.locator('[data-wc-date]').fill('2026-09-10');
  const weightCreated = page.waitForResponse(response => response.url().includes('/api/clinical/rpc/record_growth_measurement') && response.request().method() === 'POST');
  await page.locator('#wc-dialog button[type="submit"]').click();
  expect((await weightCreated).ok()).toBeTruthy();
  await expect(page.locator('#wc-dialog')).toHaveCount(0);
  const weights = await page.request.get(`/api/clinical/records/weights?baby_id=eq.${encodeURIComponent(patient.babies[0].id)}&order=measured_at.desc&limit=1`, { headers });
  expect(weights.ok()).toBeTruthy();
  expect(Number((await weights.json())[0]?.weight_g)).toBe(3456);

  await expect(quick.locator('button')).toHaveText(['WhatsApp', 'Ligar', 'Rota', 'Registrar peso', 'Adicionar foto']);
  await quick.locator('[data-action="patient-add-media"]').click();
  await expect(page.locator('.af-layer')).toBeVisible();
  await expect(page.locator('.af-layer')).toContainText('Adicionar foto ou vídeo');
  await page.locator('.af-layer .af-actions [data-af-close]').click();
  await expect(page.locator('.af-layer')).toHaveCount(0);

  await expect(page.locator('[data-prh-more]')).toBeVisible();
  await page.locator('[data-prh-more]').click();
  await expect(page.locator('.pw-layer')).toContainText('Mais ações');
  await page.locator('.pw-layer [data-pw-route]').click();
  await expect(page.locator('.pw-layer')).toHaveCount(0);
  const delegatedRoute = await page.evaluate(() => window.__quickActionOpens.at(-1)?.url || '');
  expect(decodeURIComponent(delegatedRoute)).toContain(activeAddress);

  // If the next appointment is online, Rota must not fall back to the patient's home address.
  await schedule(page, headers, patient, new Date(Date.now() + 30 * 60 * 1000).toISOString(), '', 'Online');
  await page.reload();
  await page.goto(`/app/#/patient/${patient.mother.id}`);
  await expect(page.locator('[data-patient-title]')).toContainText(patient.motherName);
  await page.evaluate(() => {
    window.__quickActionOpens = [];
    window.open = (url, target, features) => {
      window.__quickActionOpens.push({ url: String(url), target: target || '', features: features || '' });
      return null;
    };
  });
  await page.locator('.patient-quick [data-action="patient-route"]').click();
  await expect(page.locator('.app-toast')).toContainText('O próximo atendimento é online e não possui rota.');
  expect(await page.evaluate(() => window.__quickActionOpens.length)).toBe(0);
});
