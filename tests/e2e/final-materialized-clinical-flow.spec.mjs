import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLZAAAAAElFTkSuQmCC',
  'base64',
);

async function records(page, table, query = '') {
  const response = await page.request.get(`/api/clinical/records/${table}${query ? `?${query}` : ''}`, {
    headers: await authHeaders(page),
  });
  expect(response.ok(), `${table} read failed: ${response.status()}`).toBeTruthy();
  return response.json();
}

async function createPatientThroughUi(page) {
  const motherName = uniqueLabel('Final gate mother');
  const babyName = uniqueLabel('Final gate baby');
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field="name"]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  await page.locator('[name=consentClinicalMedia]').check();
  const created = page.waitForResponse(r => r.url().endsWith('/api/clinical/patients') && r.request().method() === 'POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const patient = await response.json();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
  return { patient, motherName, babyName };
}

test('final materialized build completes the critical clinical flow through real UI actions and persists the same state', async ({ page }) => {
  await login(page);
  const { patient, motherName } = await createPatientThroughUi(page);

  await page.locator('[data-action="new-appointment"]:visible').first().click();
  await expect(page.locator('[data-wizard-step="1"]')).toBeVisible();
  await expect(page.locator('[data-billing-v2]')).toBeVisible();

  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Acompanhamento"]').click();
  await page.locator('[data-encounter-choice][data-field="format"][data-value="Online"]').click();
  await expect(page.locator('[data-ccf-context-meta]')).toContainText('Acompanhamento · Online');
  await expect(page.locator('[data-bv-service]')).toHaveValue('Acompanhamento');

  await page.locator('[data-bv-service]').selectOption({ label: 'Consulta inicial' });
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Retorno"]').click();
  await page.locator('[data-encounter-choice][data-field="appointmentType"][data-value="Acompanhamento"]').click();
  await expect(page.locator('[data-ccf-context-meta]')).toContainText('Acompanhamento · Online');
  await expect(page.locator('[data-bv-service]')).toHaveValue('Consulta inicial');

  await page.locator('[data-bv-mode]').selectOption('package_new');
  await page.locator('[data-bv-total]').fill('600.00');
  await page.locator('[data-bv-sessions]').fill('3');
  await page.locator('[data-bv-payment]').selectOption({ label: 'Pix' });
  await page.locator('[data-encounter-field="startsAt"]').fill(new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));

  const started = page.waitForResponse(r => r.url().includes('/api/clinical/rpc/start_clinical_encounter') && r.request().method() === 'POST');
  await page.locator('[data-wizard-next]').click();
  expect((await started).ok()).toBeTruthy();
  await expect(page.locator('[data-wizard-step="2"]')).toBeVisible();

  const appointmentScreen = page.locator('[data-screen="appointment"]');
  const encounterId = await appointmentScreen.getAttribute('data-encounter-id');
  const appointmentId = await appointmentScreen.getAttribute('data-appointment-id');
  expect(encounterId).toBeTruthy();
  expect(appointmentId).toBeTruthy();

  const complaint = uniqueLabel('Final complaint');
  const clinicalNote = uniqueLabel('Final clinical note');
  await page.locator('[data-wizard-step="2"] [data-encounter-field="notes"]').fill(complaint);
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await page.locator('#cn-note').fill(clinicalNote);
  await page.locator('#cn-overlay [data-cn-continue]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);
  await expect(page.locator('[data-wizard-step="3"]')).toBeVisible();

  await page.locator('[data-clinical-media-input]').setInputFiles({
    name: 'final-gate.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
  });
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="4"]')).toBeVisible();

  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="5"]')).toBeVisible();
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="6"]')).toBeVisible();

  const objective = uniqueLabel('Final objective');
  const instructions = uniqueLabel('Final instructions') + ' ' + 'Orientações clínicas completas para a família. '.repeat(250) + ' FIM_UNICO_2026';
  await page.locator('[data-wizard-step="6"] [data-encounter-field="objectives"]').fill(objective);
  await page.locator('[data-wizard-step="6"] [data-encounter-field="instructions"]').fill(instructions);
  const modeSingle=page.locator('[name="care-orientation-mode"][value="single"]');
  const modeWeekly=page.locator('[name="care-orientation-mode"][value="weekly"]');
  await expect(modeSingle).toBeChecked();
  await expect(page.locator('[data-single-care-panel]')).toBeVisible();
  await expect(page.locator('[data-weekly-care-plan]')).toBeHidden();
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="7"]')).toBeVisible();
  const singleDownload=page.waitForEvent('download');
  await page.locator('[data-action="print-plan"]').click();
  const singlePdf=await singleDownload;
  const singleStream=await singlePdf.createReadStream();
  const singleChunks=[];
  for await (const chunk of singleStream) singleChunks.push(chunk);
  const singleText=Buffer.concat(singleChunks).toString('latin1');
  expect(singleText).toContain('FIM_UNICO_2026');
  expect(singleText).toContain('Final instructions');
  expect(singleText).toContain('Documento 2/');
  expect(singleText).not.toContain('Orientações - Semana 1');
  await page.locator('[data-wizard-prev]').click();
  await expect(page.locator('[data-wizard-step="6"]')).toBeVisible();
  await modeWeekly.check();
  await expect(page.locator('[data-weekly-care-plan]')).toBeVisible();
  await expect(page.locator('[data-single-care-panel]')).toBeHidden();
  await modeSingle.check();
  await expect(page.locator('[data-wizard-step="6"] [data-encounter-field="instructions"]')).toHaveValue(instructions);
  await modeWeekly.check();
  const weeklyInstructions = Array.from({ length: 4 }, (_, i) => uniqueLabel('Week-' + (i + 1)) + (i === 2 ? ' ' + 'Acompanhar a evolução com orientações detalhadas. '.repeat(180) + ' FIM_SEMANA_EXTENSA_2026' : ''));
  await expect(page.locator('[data-weekly-entry]')).toHaveCount(0);
  for (let i = 0; i < weeklyInstructions.length; i += 1) {
    await page.locator('[data-weekly-add]').click();
    await page.locator('[data-weekly-entry]').nth(i).locator('[data-weekly-instructions]').fill(weeklyInstructions[i]);
  }
  await page.locator('[data-weekly-start]').fill('2026-10-08');
  await expect(page.locator('[data-weekly-entry]')).toHaveCount(4);
  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-wizard-step="7"]')).toBeVisible();
  const pdfDownload = page.waitForEvent('download');
  await page.locator('[data-action="print-plan"]').click();
  const initialPdf = await pdfDownload;
  const initialPdfStream = await initialPdf.createReadStream();
  const pdfChunks = [];
  for await (const chunk of initialPdfStream) pdfChunks.push(chunk);
  const pdfText = Buffer.concat(pdfChunks).toString('latin1');
  for (const n of [1, 2, 3, 4]) expect(pdfText).toContain('Orientações - Semana ' + n);
  for (const [index, instruction] of weeklyInstructions.entries()) {
    if (index === 2) {
      expect(pdfText).toContain('FIM_SEMANA_EXTENSA_2026');
      expect(pdfText).toContain('Week-3');
    } else expect(pdfText).toContain(instruction);
  }
  expect(pdfText).not.toContain('FIM_UNICO_2026');

  await page.locator('[data-wizard-next]').click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName, { timeout: 20_000 });
  await expect(page.locator('[data-app-toast]')).toContainText('Atendimento salvo com segurança.');

  const [encounter] = await records(page, 'clinical_encounters', `id=eq.${encodeURIComponent(encounterId)}&limit=1`);
  expect(encounter?.status).toBe('finalized');
  expect(encounter?.mother_id).toBe(patient.mother.id);
  expect(encounter?.baby_id).toBe(patient.babies[0].id);
  expect(encounter?.appointment_id).toBe(appointmentId);
  expect(encounter?.identification?.appointmentType).toBe('Acompanhamento');
  expect(encounter?.identification?.format).toBe('Online');
  expect(encounter?.chief_complaint?.notes).toBe(complaint);
  expect(encounter?.clinical_note).toBe(clinicalNote);
  expect(encounter?.care_plan?.objectives).toBe(objective);
  expect(encounter?.care_plan?.instructions).toBe(instructions);
  expect(encounter?.care_plan?.orientation_mode).toBe('weekly');
  expect(encounter?.care_plan?.weekly_plan?.start_date).toBe('2026-10-08');
  expect(encounter?.care_plan?.weekly_plan?.weeks?.map(w => w.instructions)).toEqual(weeklyInstructions);
  await expect(page.locator('[data-action="print-care-plan-encounter"]:visible').first()).toBeVisible();

  const [appointment] = await records(page, 'appointments', `id=eq.${encodeURIComponent(appointmentId)}&limit=1`);
  expect(appointment?.status).toBe('Realizado');
  expect(appointment?.billing_mode).toBe('package_new');
  expect(appointment?.service_label).toBe('Consulta inicial');

  const packages = await records(page, 'care_packages', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  expect(packages).toHaveLength(1);
  expect(Number(packages[0].total_cents)).toBe(60000);
  expect(Number(packages[0].sessions_total)).toBe(3);
  expect(Number(packages[0].sessions_used)).toBe(1);

  const financial = await records(page, 'financial_entries', `mother_id=eq.${encodeURIComponent(patient.mother.id)}`);
  const packageCharges = financial.filter(row => row.package_id === packages[0].id);
  expect(packageCharges).toHaveLength(1);
  expect(Number(packageCharges[0].amount_cents)).toBe(60000);

  const media = await records(page, 'clinical_media', `encounter_id=eq.${encodeURIComponent(encounterId)}`);
  expect(media).toHaveLength(1);
  expect(media[0].mother_id).toBe(patient.mother.id);
  expect(media[0].baby_id).toBe(patient.babies[0].id);
  expect(media[0].encounter_id).toBe(encounterId);

  await page.locator(`[data-action="open-clinical-note"][data-encounter-id="${encounterId}"]:visible`).first().click();
  await expect(page.locator('#cn-overlay')).toBeVisible();
  await expect(page.locator('#cn-overlay')).toContainText(motherName);
  await expect(page.locator('#cn-overlay')).toContainText('Acompanhamento');
  await expect(page.locator('#cn-overlay')).toContainText('Online');
  await expect(page.locator('#cn-note')).toHaveValue(clinicalNote);
  await page.locator('#cn-overlay [data-cn-close]').click();
  await expect(page.locator('#cn-overlay')).toHaveCount(0);

  await expect(page.locator('[data-prh-card]')).toBeVisible();
  await page.locator('[data-prh-target="album"]').click();
  await expect(page.locator('.pw-photo')).toHaveCount(1);
  await expect(page.locator('.pw-photo img')).toHaveCount(1);
  const signedSrc = await page.locator('.pw-photo img').getAttribute('src');
  expect(signedSrc).toBeTruthy();
  const mediaGet = await page.request.get(signedSrc);
  expect(mediaGet.status()).toBe(200);
  expect((await mediaGet.body()).byteLength).toBeGreaterThan(0);
  await page.locator('[data-pw-close]').click();

  await page.locator('[data-nav-target="patients"]:visible').first().click();
  const patientCard = page.locator(`[data-action="open-patient"][data-patient-id="${patient.mother.id}"]:visible`).first();
  await expect(patientCard).toBeVisible();
  await patientCard.click();
  await expect(page.locator('[data-patient-title]')).toContainText(motherName);
});
