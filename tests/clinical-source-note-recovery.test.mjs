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

test('encrypted draft survives a fresh runtime, isolates professionals and never persists plaintext', async () => {
  const { webcrypto } = await import('node:crypto');
  const { TextEncoder, TextDecoder } = await import('node:util');
  const data = new Map();
  const database = {
    objectStoreNames: { contains: (name) => data.has(name) },
    createObjectStore(name) { data.set(name, new Map()); },
    transaction(store) {
      const tx = {
        oncomplete: null, onerror: null, onabort: null,
        objectStore() {
          const request = (action, value) => {
            const req = { result: undefined, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              try {
                const table = data.get(store);
                if (action === 'get') req.result = table.get(value);
                if (action === 'put') table.set(value.scope ?? value.owner, value);
                if (action === 'delete') table.delete(value);
                req.onsuccess?.();
                queueMicrotask(() => tx.oncomplete?.());
              } catch (error) { tx.error = error; tx.onerror?.(); }
            });
            return req;
          };
          return { get: (key) => request('get', key), put: (row) => request('put', row), delete: (key) => request('delete', key) };
        },
      };
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const request = { result: database, onsuccess: null, onupgradeneeded: null };
      queueMicrotask(() => {
        if (!data.has('keys')) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  const result = enhanceClinicalNoteWithRecovery(source);
  const start = result.indexOf('const cnDraftDatabaseName=');
  const end = result.indexOf('function cnDate(', start);
  assert.ok(start > 0 && end > start, 'local recovery functions are isolated');
  const code = result.slice(start, end);
  const openAs = (sub) => vm.runInNewContext(code + ';({cnDraftRead,cnDraftWrite,cnDraftRemove})', {
    indexedDB, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, Date,
    window: { indexedDB, crypto: webcrypto },
    cnJwt: () => ({ sub }), cnState: {}, cnStatus: () => {},
    clearTimeout, setTimeout,
  });

  const first = openAs('consultora-a');
  await first.cnDraftWrite('encontro-1', 'Observações sensíveis: texto fictício');
  assert.equal(JSON.stringify([...data.get('drafts').values()]).includes('Observações sensíveis'), false);
  assert.equal((await openAs('consultora-b').cnDraftRead('encontro-1')), null);
  assert.equal((await openAs('consultora-a').cnDraftRead('encontro-1')).body, 'Observações sensíveis: texto fictício');

  await first.cnDraftWrite('encontro-1', 'Revisão mais nova');
  await first.cnDraftRemove('encontro-1', 'Observações sensíveis: texto fictício');
  assert.equal((await first.cnDraftRead('encontro-1')).body, 'Revisão mais nova');
  await first.cnDraftRemove('encontro-1', 'Revisão mais nova');
  assert.equal(await first.cnDraftRead('encontro-1'), null);
});
