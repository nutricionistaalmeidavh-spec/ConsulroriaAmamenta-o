import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const clinicalHtmlPath = resolve(root, 'public/clinical-source/index.html');
const encounterFormPath = resolve(root, 'public/clinical-source/core/lib/encounter-form.js');
const clinicalNotePath = resolve(root, 'public/clinical-source/features/clinical-note-feature.js');
const featurePath = resolve(root, 'public/feeding-assessment-history-feature.js');
const rootEntryPath = resolve(root, 'index.html');
const appEntryPath = resolve(root, 'app/index.html');

const featureExists = existsSync(featurePath);

test('phase 0: current encounter contract keeps feeding assessment available to clinical appointment types', () => {
  const html = readFileSync(clinicalHtmlPath, 'utf8');
  const encounterForm = readFileSync(encounterFormPath, 'utf8');

  for (const appointmentType of ['Consulta inicial', 'Retorno', 'Acompanhamento', 'Pré-natal']) {
    assert.match(html, new RegExp(appointmentType));
  }
  assert.match(html, /data-encounter-section="feeding_assessment"/);
  assert.match(html, /Avaliação da mamada/);
  assert.match(encounterForm, /'feeding_assessment'/);
  assert.match(encounterForm, /byBaby/);
});

test('phase 0: existing clinical note write and audit surfaces remain present', () => {
  const clinicalNote = readFileSync(clinicalNotePath, 'utf8');
  assert.match(clinicalNote, /clinical_note/);
  assert.match(clinicalNote, /clinical_encounter_addenda/);
  assert.match(clinicalNote, /clinical_note_revisions/);
  assert.match(clinicalNote, /cnSave/);
  assert.match(clinicalNote, /cnAddAddendum/);
});

test('phases 1-3: feeding history feature is wired additively in both application entry points', () => {
  assert.equal(featureExists, true, 'feeding assessment history feature must exist');
  const rootEntry = readFileSync(rootEntryPath, 'utf8');
  const appEntry = readFileSync(appEntryPath, 'utf8');
  assert.match(rootEntry, /feeding-assessment-history-feature\.js/);
  assert.match(appEntry, /feeding-assessment-history-feature\.js/);
});

test('phases 1-2: structured feeding data supports multi-baby and legacy single-baby records', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?test=${Date.now()}`);
  const multi = {
    id: 'enc-2',
    baby_id: 'baby-a',
    feeding_assessment: {
      byBaby: {
        'baby-a': { position: 'Tradicional', latch: 'Superficial', suckSwallow: ['Sucção fraca'], notes: 'A' },
        'baby-b': { position: 'Invertida', latch: 'Adequada após ajuste', suckSwallow: ['Sucção rítmica', 'Deglutição audível'], notes: 'B' }
      }
    }
  };
  const rows = feature.extractEncounterFeeding(multi, ['baby-a', 'baby-b']);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.babyId === 'baby-b').assessment.position, 'Invertida');

  const legacy = {
    id: 'enc-1',
    baby_id: 'baby-a',
    feeding_assessment: { position: 'Deitada', latch: 'Superficial', suckSwallow: ['Pausas longas'], notes: 'registro antigo' }
  };
  const legacyRows = feature.extractEncounterFeeding(legacy, ['baby-a']);
  assert.deepEqual(legacyRows.map((row) => row.babyId), ['baby-a']);
  assert.equal(legacyRows[0].assessment.notes, 'registro antigo');
});

test('phase 2: longitudinal history is chronological and isolated by baby', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?history=${Date.now()}`);
  const encounters = [
    {
      id: 'return-1',
      baby_id: 'baby-a',
      occurred_at: '2026-09-12T10:00:00Z',
      identification: { appointmentType: 'Retorno' },
      feeding_assessment: { byBaby: { 'baby-a': { latch: 'Adequada após ajuste', suckSwallow: ['Sucção rítmica'] } } }
    },
    {
      id: 'initial-1',
      baby_id: 'baby-a',
      occurred_at: '2026-09-09T10:00:00Z',
      identification: { appointmentType: 'Consulta inicial' },
      feeding_assessment: { byBaby: { 'baby-a': { latch: 'Superficial', suckSwallow: ['Sucção fraca'] } } }
    },
    {
      id: 'other-baby',
      baby_id: 'baby-b',
      occurred_at: '2026-09-10T10:00:00Z',
      identification: { appointmentType: 'Acompanhamento' },
      feeding_assessment: { byBaby: { 'baby-b': { latch: 'Assimétrica' } } }
    }
  ];
  const history = feature.buildFeedingHistory(encounters, {
    'initial-1': ['baby-a'],
    'return-1': ['baby-a'],
    'other-baby': ['baby-b']
  });
  const babyA = history.filter((row) => row.babyId === 'baby-a');
  assert.deepEqual(babyA.map((row) => row.encounterId), ['initial-1', 'return-1']);
  assert.equal(history.filter((row) => row.babyId === 'baby-b').length, 1);
});

test('phase 3: comparison uses previous and initial records without clinical interpretation', { skip: !featureExists }, async () => {
  const feature = await import(`${pathToFileURL(featurePath).href}?compare=${Date.now()}`);
  const history = [
    { encounterId: 'initial', babyId: 'baby-a', occurredAt: '2026-09-09T10:00:00Z', appointmentType: 'Consulta inicial', assessment: { latch: 'Superficial', suckSwallow: ['Sucção fraca'] } },
    { encounterId: 'return', babyId: 'baby-a', occurredAt: '2026-09-12T10:00:00Z', appointmentType: 'Retorno', assessment: { latch: 'Assimétrica', suckSwallow: ['Sucção rítmica'] } },
    { encounterId: 'current', babyId: 'baby-a', occurredAt: '2026-09-18T10:00:00Z', appointmentType: 'Acompanhamento', assessment: { latch: 'Adequada após ajuste', suckSwallow: ['Sucção rítmica', 'Deglutição audível'] } }
  ];

  const previous = feature.buildFeedingComparison(history, 'current', 'baby-a', 'previous');
  assert.equal(previous?.baseline.encounterId, 'return');
  assert.equal(previous?.current.encounterId, 'current');
  assert.deepEqual(previous?.fields.find((field) => field.key === 'latch'), {
    key: 'latch',
    label: 'Pega',
    before: 'Assimétrica',
    after: 'Adequada após ajuste',
    changed: true
  });

  const initial = feature.buildFeedingComparison(history, 'current', 'baby-a', 'initial');
  assert.equal(initial?.baseline.encounterId, 'initial');
  assert.equal(initial?.fields.find((field) => field.key === 'suckSwallow')?.before, 'Sucção fraca');
  assert.equal(initial?.fields.find((field) => field.key === 'suckSwallow')?.after, 'Sucção rítmica · Deglutição audível');
});
