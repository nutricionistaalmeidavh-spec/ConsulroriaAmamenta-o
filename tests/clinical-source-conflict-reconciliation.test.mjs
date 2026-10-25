import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { enhanceClinicalNoteWithRecovery } from '../src/clinical-note-recovery.js';

const hardener = readFileSync('scripts/harden-delivery3-versioning.mjs', 'utf8');
const block = hardener.slice(hardener.indexOf('const stateLine ='), hardener.indexOf('function manifestWithNoteHash('));
const source = vm.runInNewContext(block + ';transform')(readFileSync('public/clinical-source/features/clinical-note-feature.js', 'utf8'));

test('409 reconciliation must refetch the current D1 version and preserve a local pending note', () => {
  const runtime = enhanceClinicalNoteWithRecovery(source);
  assert.match(runtime, /function cnResolveVersionConflict\(/);
  assert.match(runtime, /clinical_encounters\?id=eq\./);
  assert.match(runtime, /cnState\.pendingBody/);
  assert.match(runtime, /cnDraftWrite/);
  assert.match(runtime, /cnConflictPending/);
  assert.match(runtime, /data-cn-save-merged/);
  assert.match(runtime, /data-cn-use-server/);
  assert.match(runtime, /if\(cnConflictPending\)throw new Error/);
  assert.doesNotThrow(() => new vm.Script(runtime));
});

test('wizard version cache must have a refresh bridge after independent clinical-note saves', () => {
  const appData = readFileSync('patch-source/cloudflare-license-authority/core/lib/app-data.js', 'utf8');
  const shell = readFileSync('patch-source/agenda/app-shell.js', 'utf8');
  assert.match(appData, /refreshEncounterVersion/);
  assert.match(shell, /syncVersion:\s*\(id\)\s*=>\s*appData\.refreshEncounterVersion\(id\)/);
});

import { CLINICAL_CONFLICT_RUNTIME } from '../src/clinical-note-conflict.js';

function conflictFixture(remoteText) {
  const state = {
    encounter: { id: 'e1', clinical_note: 'texto original', record_version: 1 },
    pendingBody: { body: 'texto da consultora', revision: 3 },
    saveTimer: null,
  };
  const note = { value: 'texto da consultora', readOnly: false, focus() {}, insertAdjacentElement(_pos, node) { this.banner = node; } };
  const buttons = {};
  const banner = {
    innerHTML: '', style: {}, setAttribute() {}, remove() { this.removed = true; },
    querySelector(selector) { return buttons[selector] ??= {}; },
  };
  const statuses = [], saves = [], timers = [];
  let syncs = 0;
  const context = {
    cnState: state,
    cnRest: async () => [{ id: 'e1', clinical_note: remoteText, record_version: 7 }],
    cnDraftRemove: async () => {},
    cnDraftWrite: async () => {},
    cnE: (v) => String(v).replaceAll('<', '&lt;'),
    cnStatus: (...args) => statuses.push(args),
    cnDrainSaves: async () => {},
    cnScheduleSave: (value) => saves.push(value),
    cnRetryTimer: null,
    cnRetryDelay: 1500,
    clearTimeout() {},
    setTimeout(callback) { timers.push(callback); return 1; },
    document: {
      querySelector(selector) { return selector === '#cn-note' ? note : null; },
      createElement() { return banner; },
    },
    window: { DeboraEncounter: { async syncVersion() { syncs++; } } },
    encodeURIComponent,
  };
  const api = vm.runInNewContext(CLINICAL_CONFLICT_RUNTIME +
    '\n;({cnResolveVersionConflict,cnScheduleRetry,cnIsVersionConflict})', context);
  return { state, note, buttons, banner, statuses, saves, timers, api, syncs: () => syncs };
}

test('unrelated D1 update retries with fresh version without overwriting clinical text', async () => {
  const f = conflictFixture('texto original');
  await f.api.cnResolveVersionConflict();
  assert.equal(f.state.encounter.record_version, 7);
  assert.equal(f.state.pendingBody.body, 'texto da consultora');
  assert.equal(f.note.readOnly, false);
  assert.equal(f.saves.length, 0);
  assert.equal(f.timers.length, 1);
  assert.equal(f.syncs(), 1);
});

test('different note requires explicit review and never silently overwrites D1', async () => {
  const f = conflictFixture('outra informação clínica <sensível>');
  await f.api.cnResolveVersionConflict();
  assert.equal(f.note.readOnly, true);
  assert.equal(f.state.pendingBody.body, 'texto da consultora');
  assert.match(f.banner.innerHTML, /outra informação clínica &lt;sensível>/);
  assert.equal(f.saves.length, 0);
  assert.equal(f.timers.length, 0);
  f.buttons['[data-cn-merge]'].onclick();
  assert.equal(f.note.readOnly, false);
  f.note.value = 'texto mesclado após revisão';
  f.buttons['[data-cn-save-merged]'].onclick();
  assert.deepEqual(f.saves, ['texto mesclado após revisão']);
  assert.equal(f.state.encounter.record_version, 7);
});

test('only a recognized version conflict invokes the clinical reconciling handler', () => {
  const f = conflictFixture('texto original');
  assert.equal(f.api.cnIsVersionConflict(new Error('O prontuário foi alterado em outra sessão. Recarregue antes de salvar.')), true);
  assert.equal(f.api.cnIsVersionConflict(Object.assign(new Error('Serviço indisponível'), { status: 503 })), false);
});
