import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { enhanceClinicalWizardWithRecovery } from '../src/clinical-wizard-recovery.js';

const shell = readFileSync('public/clinical-source/core/app-shell.js', 'utf8');
const bootstrap = readFileSync('src/bootstrap.js', 'utf8');
const source = enhanceClinicalWizardWithRecovery(shell, 'blob:https://example.test/wizard-store');

test('recovery enhances the canonical encounter runtime for all seven sections without creating a second backend', () => {
  assert.match(source, /wizardEncryptedStore\.write/);
  assert.match(source, /wizardEncryptedStore\.scope/);
  assert.match(source, /wizardPersistLocalSnapshot/);
  assert.match(source, /wizardOfferRecovery/);
  assert.match(source, /data-wizard-restore/);
  assert.match(source, /data-wizard-discard/);
  assert.match(source, /wizardRecoveryOpen = true/);
  assert.match(source, /appointmentScreen\.inert = true/);
  assert.match(source, /wizardCaptureLocal/);
  assert.match(source, /collectEncounterDraft\(appointmentScreen\)/);
  assert.match(source, /applyEncounterDraft\(appointmentScreen, value\.state\)/);
  assert.match(source, /renderBabyClinicalSections\(\)/);
  assert.match(source, /wizardStep = Math\.max\(1, Math\.min\(7/);
  assert.match(source, /wizardConfirmSaved\(wizardSavedSnapshot\)/);
  assert.match(source, /wizardConfirmSaved\(wizardFinalSnapshot\)/);
  assert.match(source, /wizardIsVersionConflict/);
  assert.match(source, /scheduleEncounterAutosave\(false\)/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*wizard/);
  for (const name of ['identification', 'chief_complaint', 'maternal_assessment', 'baby_assessment', 'feeding_assessment', 'care_plan', 'finalization']) {
    const schema = readFileSync('public/clinical-source/core/lib/encounter-form.js', 'utf8');
    assert.ok(schema.includes(name), 'missing canonical section ' + name);
  }
  assert.match(bootstrap, /enhanceClinicalWizardWithRecovery\(shell, wizardStorageUrl\)/);
  assert.match(bootstrap, /encrypted-wizard-drafts\.js\?raw/);
  assert.match(source, /appData\.updateEncounter\(currentDraftEncounterId, payload\)/);
  assert.equal(enhanceClinicalWizardWithRecovery(source, 'blob:https://example.test/wizard-store'), source);
});

test('generated browser module parses as JavaScript and does not alter D1 APIs or session sources', () => {
  const withoutImports = source.replace(/^import .*$/gm, '').replace('export function configured()', 'function configured()');
  assert.doesNotThrow(() => new vm.Script(withoutImports));
  assert.match(source, /appData\.startClinicalEncounter\(/);
  assert.match(source, /appData\.startClinicalEncounterFromAppointment\(/);
  assert.match(source, /window\.DeboraEncounter=/);
});

test('enhancer fails closed if the expected clinical shell anchors disappear', () => {
  assert.throws(() => enhanceClinicalWizardWithRecovery('', 'blob:https://example.test/x'), /Âncora canônica/);
  assert.throws(() => enhanceClinicalWizardWithRecovery(shell, ''), /Módulo criptográfico/);
  assert.throws(() => enhanceClinicalWizardWithRecovery(shell, 'javascript:alert(1)'), /Módulo criptográfico/);
});

test('saves preserve in-flight edits and only clean local copies after SQL success', () => {
  assert.match(source, /wizardLocalRevision > wizardConfirmedRevision/);
  assert.match(source, /if \(Number\(row\.revision\) > Number\(snapshot\.value\.revision\)\) continue/);
  const savedAt = source.indexOf('const saved = await appData.updateEncounter(currentDraftEncounterId, payload);');
  const confirmedAt = source.indexOf('await wizardConfirmSaved(wizardSavedSnapshot);', savedAt);
  assert.ok(savedAt >= 0 && confirmedAt > savedAt, 'local cleanup must follow verified SQL save');
  const startedAt = source.indexOf('await ensureEncounterStarted();', source.indexOf('async function saveDraft('));
  const encryptedAt = source.lastIndexOf('await wizardPersistLocalSnapshot().catch(wizardStorageWarning);', startedAt);
  assert.ok(encryptedAt >= 0 && encryptedAt < startedAt, 'write local copy before first network call');
});


test('input, checkbox, baby-target choices and seven-step controls persist encrypted local drafts before SQL confirmation', () => {
  assert.match(source, /appointmentScreen\?\.addEventListener\('input', scheduleEncounterAutosave\)/);
  assert.match(source, /appointmentScreen\?\.addEventListener\('change', scheduleEncounterAutosave\)/);
  assert.match(source, /wizardCaptureLocal\(\);/);
  assert.match(source, /if \(capture\?\.target\?\.matches\?\.\('\[data-appointment-patient\]'\)\) return/);
  assert.match(source, /appointmentScreen\?\.addEventListener\('click', \(event\) =>/);
  assert.match(source, /queueMicrotask\(wizardCaptureLocal\)/);
  assert.match(source, /if \(wizardStep > 1\)[^\n]+wizardCaptureLocal\(\)/);
  assert.match(source, /const wizardSavedSnapshot = await wizardPersistLocalSnapshot\(clinicalState\)/);
  assert.match(source, /await wizardConfirmSaved\(wizardSavedSnapshot\)/);
  assert.match(source, /wizardLocalRevision > wizardConfirmedRevision/);
});

test('recovery must not read a previous patient into the next patient and does not save while decision is pending', () => {
  assert.match(source, /motherId !== selectedWizardPatient\(\)\?\.mother\?\.id/);
  assert.match(source, /wizardRecoveryOpen = true/);
  assert.match(source, /appointmentScreen\.inert = true/);
  assert.match(source, /if \(!currentDraftEncounterId \|\| wizardRecoveryOpen\) return/);
  assert.match(source, /await wizardEncryptedStore\.clear\(key, value\)/);
  assert.match(source, /wizardDismissRecovery\(\)/);
});


test('new unsaved consultation cannot be offered inside a different persisted encounter', () => {
  assert.match(source, /!encounterId\s*&&\s*!appointmentId/);
  assert.match(source, /wizardEncryptedStore\.scope\(ownerId, motherId, \{ encounterId \}\)/);
  assert.match(source, /wizardEncryptedStore\.scope\(ownerId, motherId, \{ appointmentId \}\)/);
});
