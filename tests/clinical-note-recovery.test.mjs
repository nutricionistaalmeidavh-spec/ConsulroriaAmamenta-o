import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { enhanceClinicalNoteWithRecovery } from '../src/clinical-note-recovery.js';

const source = readFileSync('public/clinical-source/features/clinical-note-feature.js', 'utf8');

test('clinical note recovery preserves canonical REST contract, guards draft restore and encrypts local content', () => {
  const result = enhanceClinicalNoteWithRecovery(source);
  assert.match(result, /indexedDB\.open\(/);
  assert.match(result, /crypto\.subtle\.encrypt\(/);
  assert.match(result, /crypto\.subtle\.decrypt\(/);
  assert.match(result, /extractable|generateKey\(\{name:'AES-GCM',length:256\},false/);
  assert.match(result, /cnDraftScope\(/);
  assert.match(result, /data-cn-restore/);
  assert.match(result, /data-cn-discard/);
  assert.match(result, /await cnDraftRead\(enc\.id\)/);
  assert.match(result, /_expected_version:expectedVersion/);
  assert.match(result, /cnScheduleRetry\(error\)/);
  assert.doesNotMatch(result, /localStorage\.setItem\([^\n]*clinical_note/);
  assert.equal(enhanceClinicalNoteWithRecovery(result), result);
});

test('failed clinical note PATCH keeps latest draft queued rather than discarding it', async () => {
  const result = enhanceClinicalNoteWithRecovery(source);
  const body = result.match(/async function cnDrainSaves\(\)\{[^\n]+/);
  assert.ok(body, 'serialized drain must exist in the note runtime');
  const state = { pendingBody: { body: 'texto digitado', revision: 2 }, saveChain: Promise.resolve(), encounter: { id: 'e1' } };
  const queue = vm.runInNewContext(body[0] + ';cnDrainSaves', {
    cnState: state,
    cnPersistSave: async () => { throw Object.assign(new Error('offline'), { status: 503 }); },
    cnScheduleRetry: () => {},
  });
  await assert.rejects(queue(), /offline/);
  assert.equal(state.pendingBody.body, 'texto digitado');
  assert.equal(state.pendingBody.revision, 2);
});

test('saving an older draft cannot clear a newer local revision', () => {
  const result = enhanceClinicalNoteWithRecovery(source);
  assert.match(result, /if\(expectedBody!==undefined&&body!==String\(expectedBody\)\)return/);
  assert.match(result, /await cnDraftRemove\(enc\.id,text\)\.catch/);
});

test('recovery enhancer fails closed when canonical source anchors change', () => {
  assert.throws(() => enhanceClinicalNoteWithRecovery(''), /clinical recovery anchor/i);
});
