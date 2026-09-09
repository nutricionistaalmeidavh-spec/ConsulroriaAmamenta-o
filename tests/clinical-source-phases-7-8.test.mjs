import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const feedingFeaturePath = resolve(root, 'public/feeding-assessment-history-feature.js');
const careFlowPath = resolve(root, 'public/clinical-care-flow-feature.js');

async function feedingFeature(suffix) {
  return import(`${pathToFileURL(feedingFeaturePath).href}?${suffix}=${Date.now()}`);
}
async function careFlow(suffix) {
  return import(`${pathToFileURL(careFlowPath).href}?${suffix}=${Date.now()}`);
}

test('phase 7 regression matrix: canonical encounter remains a single seven-step flow for every appointment type', () => {
  const html = read('public/clinical-source/index.html');
  const form = read('public/clinical-source/core/lib/encounter-form.js');
  assert.equal((html.match(/data-wizard-step=/g) || []).length, 7);
  for (const type of ['Consulta inicial', 'Retorno', 'Acompanhamento', 'Pré-natal']) assert.match(html, new RegExp(type));
  for (const section of ['identification', 'chief_complaint', 'maternal_assessment', 'baby_assessment', 'feeding_assessment', 'care_plan', 'finalization']) {
    assert.match(form, new RegExp(`['\"]${section}['\"]`));
  }
});

test('phase 7 regression matrix: multi-baby and legacy feeding records remain readable together', async () => {
  const feature = await feedingFeature('multi');
  const legacy = feature.extractEncounterFeeding({
    id: 'legacy', baby_id: 'baby-a', feeding_assessment: { latch: 'Superficial', notes: 'antigo' }
  }, ['baby-a']);
  const multi = feature.extractEncounterFeeding({
    id: 'multi', feeding_assessment: { byBaby: {
      'baby-a': { latch: 'Adequada após ajuste', suckSwallow: ['Sucção rítmica'] },
      'baby-b': { latch: 'Assimétrica', suckSwallow: ['Deglutição audível'] }
    } }
  }, ['baby-a', 'baby-b']);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].babyId, 'baby-a');
  assert.equal(multi.length, 2);
  assert.deepEqual(new Set(multi.map((row) => row.babyId)), new Set(['baby-a', 'baby-b']));
});

test('phase 7 regression matrix: longitudinal comparison stays objective and baby-scoped', async () => {
  const feature = await feedingFeature('compare');
  const history = feature.buildFeedingHistory([
    { id: 'initial-a', baby_id: 'a', occurred_at: '2026-09-01T10:00:00Z', identification: { appointmentType: 'Consulta inicial' }, feeding_assessment: { byBaby: { a: { latch: 'Superficial' } } } },
    { id: 'return-b', baby_id: 'b', occurred_at: '2026-09-02T10:00:00Z', identification: { appointmentType: 'Retorno' }, feeding_assessment: { byBaby: { b: { latch: 'Assimétrica' } } } },
    { id: 'return-a', baby_id: 'a', occurred_at: '2026-09-03T10:00:00Z', identification: { appointmentType: 'Retorno' }, feeding_assessment: { byBaby: { a: { latch: 'Adequada após ajuste' } } } }
  ], { 'initial-a': ['a'], 'return-b': ['b'], 'return-a': ['a'] });
  const comparison = feature.buildFeedingComparison(history, 'return-a', 'a', 'previous');
  assert.equal(comparison.baseline.encounterId, 'initial-a');
  assert.equal(comparison.current.encounterId, 'return-a');
  assert.equal(comparison.fields.find((field) => field.key === 'latch').changed, true);
  assert.doesNotMatch(JSON.stringify(comparison), /melhor|pior|adequado clinicamente|evoluiu/i);
});

test('phase 7 regression matrix: professional clinical note and audit trail remain intact', () => {
  const note = read('public/clinical-source/features/clinical-note-feature.js');
  for (const token of ['clinical_note', 'clinical_encounter_addenda', 'clinical_note_revisions', 'cnSave', 'cnAddAddendum']) assert.match(note, new RegExp(token));
});

test('phase 7 regression matrix: care-plan additions remain compatible with the existing summary field', async () => {
  const feature = await careFlow('plan');
  const summary = feature.buildCarePlanInstructions({
    priorityGuidance: 'Prioridade',
    feedingPositioning: 'Posicionamento',
    expressionSupplement: 'Ordenha quando indicada',
    routine: 'Rotina',
    warningSigns: 'Sinais combinados'
  });
  for (const value of ['Prioridade', 'Posicionamento', 'Ordenha quando indicada', 'Rotina', 'Sinais combinados']) assert.match(summary, new RegExp(value));
  const encounterForm = read('public/clinical-source/core/lib/encounter-form.js');
  assert.match(encounterForm, /care_plan/);
});

test('phase 7 regression matrix: mother-facing allowlist remains fail-closed for professional-only content', async () => {
  const feature = await careFlow('privacy');
  for (const item of [
    { kind: 'evaluation', title: 'Avaliação completa' },
    { kind: 'anamnesis', title: 'Anamnese' },
    { kind: 'referral', title: 'Encaminhamento' },
    { kind: 'document', title: 'Prontuário completo' },
    { kind: 'care_plan', title: 'Plano antigo', published: false }
  ]) assert.equal(feature.isMotherShareAllowed(item), false);
  for (const item of [
    { kind: 'care_plan', title: 'Plano de cuidado' },
    { kind: 'orientation', title: 'Orientações' },
    { kind: 'document', title: 'Termo de consentimento' },
    { kind: 'appointment', title: 'Próximo retorno' }
  ]) assert.equal(feature.isMotherShareAllowed(item), true);
});

test('phase 7 regression matrix: referrals, PDFs, export and patient records hub remain reachable', () => {
  const loader = read('public/phase68-loader.js');
  for (const file of ['referral-finalization.js', 'record-export-feature.js', 'patient-workspace.js', 'patient-records-hub.js']) assert.match(loader, new RegExp(file.replace('.', '\\.')));
  const referral = read('public/referral-finalization.js');
  assert.match(referral, /status:'finalized'/);
  assert.match(referral, /createReferralPdf/);
  const exportFeature = read('public/record-export-feature.js');
  assert.match(exportFeature, /feeding_assessment/);
  assert.match(exportFeature, /care_plan/);
});

test('phase 8 integrated verification: root and app entries load the clinical layers once and in the intended order', () => {
  for (const entry of ['index.html', 'app/index.html']) {
    const source = read(entry);
    const scripts = ['phase02-loader.js', 'phase35-loader.js', 'phase68-loader.js', 'feeding-assessment-history-feature.js', 'clinical-care-flow-feature.js'];
    for (const script of scripts) assert.equal((source.match(new RegExp(script.replace('.', '\\.'), 'g')) || []).length, 1, `${script} duplicated in ${entry}`);
    for (let index = 1; index < scripts.length; index += 1) assert.ok(source.indexOf(scripts[index - 1]) < source.indexOf(scripts[index]), `${scripts[index - 1]} must load before ${scripts[index]} in ${entry}`);
  }
});

test('phase 8 integrated verification: one encounter can carry feeding history, structured care plan and a safe mother summary without cross-leaking clinical sections', async () => {
  const feeding = await feedingFeature('integrated-feeding');
  const care = await careFlow('integrated-care');
  const encounter = {
    id: 'enc-current', baby_id: 'baby-a', occurred_at: '2026-09-09T10:00:00Z',
    identification: { appointmentType: 'Retorno' },
    chief_complaint: { notes: 'PRIVADO QUEIXA' },
    maternal_assessment: { notes: 'PRIVADO MATERNA' },
    baby_assessment: { notes: 'PRIVADO BEBÊ' },
    feeding_assessment: { byBaby: { 'baby-a': { beforeFeed: 'Acordado', position: 'Tradicional', latch: 'Adequada após ajuste', suckSwallow: ['Sucção rítmica'], afterFeed: 'Relaxado' } } },
    care_plan: { objectives: 'Objetivo liberado', instructions: 'Orientação liberada', followup: '48 horas' },
    finalization: { notes: 'PRIVADO FINAL' }
  };
  const feedingRows = feeding.extractEncounterFeeding(encounter, ['baby-a']);
  assert.equal(feedingRows.length, 1);
  assert.equal(feedingRows[0].assessment.latch, 'Adequada após ajuste');
  const mother = care.buildMotherSafeEncounterShare(encounter);
  assert.match(mother.body, /Objetivo liberado/);
  assert.match(mother.body, /Orientação liberada/);
  assert.match(mother.body, /48 horas/);
  assert.doesNotMatch(mother.body, /PRIVADO|Acordado|Tradicional|Adequada após ajuste|Sucção rítmica|Relaxado/);
});

test('phase 8 integrated verification: no replacement clinical wizard or duplicate source of truth is introduced by phases 1-6', () => {
  const feeding = read('public/feeding-assessment-history-feature.js');
  const care = read('public/clinical-care-flow-feature.js');
  assert.doesNotMatch(feeding, /method:\s*['\"]POST['\"][\s\S]*clinical_encounters/i);
  assert.doesNotMatch(care, /method:\s*['\"]POST['\"][\s\S]*clinical_encounters/i);
  assert.match(read('public/clinical-source/core/lib/encounter-form.js'), /buildEncounterPayload/);
});
