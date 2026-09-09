import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { collectEncounterDraft } from '../public/clinical-source/core/lib/encounter-form.js';

const root = resolve(import.meta.dirname, '..');
const featurePath = resolve(root, 'public/initial-maternal-history-feature.js');
const careFlowPath = resolve(root, 'public/clinical-care-flow-feature.js');
const feature = await import(`${pathToFileURL(featurePath).href}?initial-history=${Date.now()}`);
const careFlow = await import(`${pathToFileURL(careFlowPath).href}?initial-history-safe=${Date.now()}`);
const source = readFileSync(featurePath, 'utf8');
const css = readFileSync(resolve(root, 'public/initial-maternal-history-feature.css'), 'utf8');
const html = readFileSync(resolve(root, 'public/clinical-source/index.html'), 'utf8');

test('initial maternal history module is wired additively in both application entries', () => {
  assert.match(readFileSync(resolve(root, 'index.html'), 'utf8'), /initial-maternal-history-feature\.js/);
  assert.match(readFileSync(resolve(root, 'app/index.html'), 'utf8'), /initial-maternal-history-feature\.js/);
});

test('initial maternal history is restricted to Consulta inicial in the UI contract', () => {
  assert.equal(feature.isInitialMaternalHistoryVisible('Consulta inicial'), true);
  assert.equal(feature.isInitialMaternalHistoryVisible('Retorno'), false);
  assert.equal(feature.isInitialMaternalHistoryVisible('Acompanhamento'), false);
  assert.equal(feature.isInitialMaternalHistoryVisible('Pré-natal'), false);
});

test('medication rows serialize into the existing maternal assessment JSON without a new table', () => {
  const text = feature.serializeMedicationRows([
    { name: 'Levotiroxina', dose: '50 mcg', frequency: '1x/dia' },
    { name: 'Vitamina D', dose: '', frequency: 'semanal' },
    { name: '', dose: 'ignorar', frequency: '' }
  ]);
  assert.equal(text, 'Levotiroxina | 50 mcg | 1x/dia\nVitamina D |  | semanal');
  assert.deepEqual(feature.medicationRowsFromText(text), [
    { name: 'Levotiroxina', dose: '50 mcg', frequency: '1x/dia' },
    { name: 'Vitamina D', dose: '', frequency: 'semanal' }
  ]);
});

test('history summary counts answered items without making clinical interpretations', () => {
  const summary = feature.initialMaternalHistorySummary({
    assistedReproduction: 'Sim',
    chronicConditionsHistory: 'Não',
    medicationUse: 'Sim',
    medications: 'Levotiroxina | 50 mcg | 1x/dia\nVitamina D |  | semanal',
    supplementsUse: '',
    allergiesKnown: 'Não informado',
    pregnancyComplications: 'Não',
    breastSurgeryHistory: '',
    previousBreastfeedingHistory: 'Sim'
  });
  assert.equal(summary.answered, 6);
  assert.equal(summary.medications, 2);
  assert.equal(summary.label, '6 respostas · 2 medicamentos');
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'risk'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(summary, 'diagnosis'), false);
});

test('step 3 mounts a collapsible progressive-disclosure history using existing maternal_assessment fields', () => {
  assert.match(source, /ccfMaternalHistory/);
  assert.match(source, /HISTÓRICO CLÍNICO E GESTACIONAL/);
  for (const field of [
    'assistedReproduction','assistedReproductionNotes','chronicConditionsHistory','chronicConditionsDetails',
    'medicationUse','medications','supplementsUse','supplements','allergiesKnown','allergies',
    'pregnancyComplications','pregnancyComplicationsDetails','breastSurgeryHistory','breastSurgeryDetails',
    'previousBreastfeedingHistory','previousBreastfeedingDetails'
  ]) {
    const generated = source.includes(`selectField('${field}'`) || source.includes(`detailTextarea('${field}'`) || source.includes(`data-encounter-field=\"${field}\"`);
    assert.equal(generated, true, `${field} must be mounted as a maternal_assessment encounter field`);
  }
  assert.match(source, /data-section=\"maternal_assessment\"/);
  assert.match(source, /data-ccf-history-detail/);
  assert.match(source, /data-ccf-add-med/);
  assert.match(source, /O sistema não avalia compatibilidade ou risco/);
  assert.match(css, /\.ccf-history-card/);
  assert.match(css, /\.ccf-medication-row/);
});

test('canonical encounter collector persists new history fields inside maternal_assessment', () => {
  const controls = [
    { type: 'select-one', value: 'Sim', dataset: { section: 'maternal_assessment', encounterField: 'assistedReproduction' } },
    { type: 'textarea', value: 'FIV relatada pela paciente', dataset: { section: 'maternal_assessment', encounterField: 'assistedReproductionNotes' } },
    { type: 'select-one', value: 'Sim', dataset: { section: 'maternal_assessment', encounterField: 'medicationUse' } },
    { type: 'hidden', value: 'Levotiroxina | 50 mcg | 1x/dia', dataset: { section: 'maternal_assessment', encounterField: 'medications' } }
  ];
  const rootStub = {
    querySelectorAll(selector) {
      if (selector === '[data-encounter-field]') return controls;
      if (selector === '[data-encounter-choice][aria-pressed="true"]') return [];
      return [];
    }
  };
  const draft = collectEncounterDraft(rootStub);
  assert.equal(draft.maternal_assessment.assistedReproduction, 'Sim');
  assert.equal(draft.maternal_assessment.assistedReproductionNotes, 'FIV relatada pela paciente');
  assert.equal(draft.maternal_assessment.medicationUse, 'Sim');
  assert.equal(draft.maternal_assessment.medications, 'Levotiroxina | 50 mcg | 1x/dia');
  assert.equal(Object.prototype.hasOwnProperty.call(draft, 'maternal_history'), false);
});

test('maternal history stays private and is not included in mother portal safe summaries', () => {
  const share = careFlow.buildMotherSafeEncounterShare({
    maternal_assessment: {
      chronicConditionsDetails: 'NÃO EXPOR DOENÇA',
      medications: 'NÃO EXPOR MEDICAÇÃO',
      allergies: 'NÃO EXPOR ALERGIA'
    },
    care_plan: { objectives: 'Objetivo compartilhável', instructions: 'Orientação compartilhável', followup: '48 horas' }
  });
  assert.match(share.body, /Objetivo compartilhável/);
  assert.doesNotMatch(share.body, /NÃO EXPOR/);
});

test('the clinical wizard remains exactly seven steps and no extra section is introduced', () => {
  assert.equal((html.match(/data-wizard-step=/g) || []).length, 7);
  const encounterForm = readFileSync(resolve(root, 'public/clinical-source/core/lib/encounter-form.js'), 'utf8');
  assert.match(encounterForm, /'maternal_assessment'/);
  assert.doesNotMatch(encounterForm, /maternal_history/);
});
