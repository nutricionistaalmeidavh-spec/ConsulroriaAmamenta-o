import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

async function createPatient(request, headers, prefix, consents = { data_processing: true }) {
  const motherName = uniqueLabel(`${prefix} mother`);
  const babyName = uniqueLabel(`${prefix} baby`);
  const response = await request.post('/api/clinical/patients', {
    headers: { ...headers, 'content-type': 'application/json', 'idempotency-key': uniqueLabel(`${prefix}-patient`) },
    data: { mother: { name: motherName }, babies: [{ name: babyName, birth_weight_g: 3200, current_weight_g: 3300 }], consents },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()), motherName, babyName };
}

async function createRecord(request, headers, table, body) {
  const response = await request.post(`/api/clinical/records/${table}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: body,
  });
  expect(response.status()).toBe(201);
  return (await response.json())[0];
}

async function startEncounter(request, headers, patient, { occurredAt, finalizePatch = null } = {}) {
  const started = await request.post('/api/clinical/rpc/start_clinical_encounter', {
    headers: { ...headers, 'content-type': 'application/json' },
    data: {
      p_mother_id: patient.mother.id,
      p_baby_ids: [patient.babies[0].id],
      p_starts_at: occurredAt || '2026-09-22T14:00:00.000Z',
      p_appointment_type: 'Retorno',
      p_request_key: uniqueLabel('p0-encounter'),
    },
  });
  expect(started.status()).toBe(200);
  const identity = await started.json();
  if (!finalizePatch) return { id: identity.encounter_id, appointment_id: identity.appointment_id, record_version: 0 };

  const finalized = await request.patch(`/api/clinical/records/clinical_encounters?id=eq.${encodeURIComponent(identity.encounter_id)}`, {
    headers: { ...headers, 'content-type': 'application/json' },
    data: { ...finalizePatch, _expected_version: 0 },
  });
  expect(finalized.status()).toBe(200);
  return (await finalized.json())[0];
}

test('patient switch clears previous clinical projection before failed reads can leave stale data', async ({ page }) => {
  await login(page);
  const headers = await authHeaders(page);
  const first = await createPatient(page.request, headers, 'Stale A');
  const second = await createPatient(page.request, headers, 'Stale B');
  await createRecord(page.request, headers, 'weights', { baby_id: first.babies[0].id, measured_at: '2026-09-22T12:00:00.000Z', weight_g: 4321 });
  await startEncounter(page.request, headers, first, {
    occurredAt: '2026-09-22T13:00:00.000Z',
    finalizePatch: { status: 'finalized', chief_complaint: { notes: 'CLINICAL-A-ONLY' } },
  });

  await page.reload();
  await page.locator('[data-nav-target=patients]:visible').first().click();
  await page.locator(`[data-action="open-patient"][data-patient-id="${first.mother.id}"]`).click();
  await expect(page.locator('[data-patient-weights-live]')).toContainText('4.321 g');
  await expect(page.locator('[data-patient-timeline-live]')).toContainText('CLINICAL-A-ONLY');

  await page.locator('[data-nav-target=patients]:visible').first().click();
  await page.route('**/api/clinical/records/weights?**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic read failure' }) });
    return route.continue();
  });
  await page.locator(`[data-action="open-patient"][data-patient-id="${second.mother.id}"]`).click();
  await expect(page.locator('[data-patient-title]')).toContainText(second.motherName);
  await expect(page.locator('[data-patient-weights-live]')).not.toContainText('4.321 g');
  await expect(page.locator('[data-patient-timeline-live]')).not.toContainText('CLINICAL-A-ONLY');
});

test('consent read failure blocks edit submit instead of sending reset checkbox values', async ({ page }) => {
  await login(page);
  const headers = await authHeaders(page);
  const patient = await createPatient(page.request, headers, 'Consent guard', { data_processing: true, whatsapp: true, clinical_media: true, public_media: false });
  await page.reload();
  await page.goto(`/app/#/patient/${patient.mother.id}`);
  await page.route('**/api/clinical/records/consents?**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic consent failure' }) });
    return route.continue();
  });
  await page.locator('[data-action=edit-patient]:visible').first().click();
  await expect(page.locator('[data-patient-form] button[type=submit]:visible').first()).toBeDisabled();
  await expect(page.locator('[data-patient-form-status]')).toContainText(/autoriza|consent|carregar/i);
});

test('clinical note save failure keeps the note open and preserves unsaved text', async ({ page }) => {
  await login(page);
  const headers = await authHeaders(page);
  const patient = await createPatient(page.request, headers, 'Clinical note');
  const encounter = await startEncounter(page.request, headers, patient, { occurredAt: '2026-09-22T14:00:00.000Z' });
  await page.waitForFunction(() => Boolean(window.DeboraClinicalNote?.openEncounter));
  await page.evaluate(id => window.DeboraClinicalNote.openEncounter(id, { direction: 'history' }), encounter.id);
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await page.route('**/api/clinical/records/clinical_encounters?**', async route => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'synthetic note save failure' }) });
    return route.continue();
  });
  const unsaved = 'Texto P0 que não pode desaparecer';
  await page.locator('#cn-note').fill(unsaved);
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await expect(page.locator('#cn-note')).toHaveValue(unsaved);
  await expect(page.locator('#cn-save-status')).toHaveAttribute('data-tone', 'error');
});

test('clinical note persists after save, close, reopen and full page reload', async ({ page }) => {
  await login(page);
  const headers = await authHeaders(page);
  const patient = await createPatient(page.request, headers, 'Clinical note persistence');
  const encounter = await startEncounter(page.request, headers, patient, { occurredAt: '2026-09-22T15:00:00.000Z' });
  const persisted = uniqueLabel('Nota clínica persistida');

  const openEncounter = async () => {
    await page.waitForFunction(() => Boolean(window.DeboraClinicalNote?.openEncounter));
    await page.evaluate(id => window.DeboraClinicalNote.openEncounter(id, { direction: 'history' }), encounter.id);
    await expect(page.locator('#cn-overlay')).toBeVisible();
  };

  await openEncounter();
  await page.locator('#cn-note').fill(persisted);
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toBeHidden();

  await openEncounter();
  await expect(page.locator('#cn-note')).toHaveValue(persisted);
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toBeHidden();

  await page.reload();
  await openEncounter();
  await expect(page.locator('#cn-note')).toHaveValue(persisted);
});
