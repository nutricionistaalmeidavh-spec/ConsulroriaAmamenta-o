import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const featurePath = resolve(root, 'public/clinical-care-flow-feature.js');
const feature = await import(`${pathToFileURL(featurePath).href}?initial-history=${Date.now()}`);
const source = readFileSync(featurePath, 'utf8');
const css = readFileSync(resolve(root, 'public/clinical-care-flow-feature.css'), 'utf8');
const html = readFileSync(resolve(root, 'public/clinical-source/index.html'), 'utf8');

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
  assert.match(source, /data-ccf-maternal-history/);
  assert.match(source, /HISTÓRICO CLÍNICO E GESTACIONAL/);
  for (const field of [
    'assistedReproduction','assistedReproductionNotes','chronicConditionsHistory','chronicConditionsDetails',
    'medicationUse','medications','supplementsUse','supplements','allergiesKnown','allergies',
    'pregnancyComplications','pregnancyComplicationsDetails','breastSurgeryHistory','breastSurgeryDetails',
    'previousBreastfeedingHistory','previousBreastfeedingDetails'
  ]) {
    assert.match(source, new RegExp(`data-encounter-field=["']${field}["']`), `${field} must be persisted through maternal_assessment`);
  }
  assert.match(source, /data-section=["']maternal_assessment["']/);
  assert.match(source, /data-ccf-history-detail/);
  assert.match(source, /data-ccf-add-med/);
  assert.match(css, /\.ccf-history-card/);
  assert.match(css, /\.ccf-medication-row/);
});

test('maternal history stays private and is not included in mother portal safe summaries', () => {
  const share = feature.buildMotherSafeEncounterShare({
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
