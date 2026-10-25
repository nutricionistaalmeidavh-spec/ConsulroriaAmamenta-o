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
