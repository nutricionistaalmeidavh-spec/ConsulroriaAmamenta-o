import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createEncryptedWizardDraftStore } from '../src/encrypted-wizard-drafts.js';

function fakeIndexedDB() {
  const stores = new Map();
  const db = {
    objectStoreNames: { contains(name) { return stores.has(name); } },
    createObjectStore(name) { stores.set(name, new Map()); },
    close() {},
    transaction(name) {
      const tx = { oncomplete: null, onerror: null, onabort: null, error: null };
      tx.objectStore = () => {
        const execute = (method, input) => {
          const request = { onsuccess: null, onerror: null, result: undefined };
          queueMicrotask(() => {
            try {
              const table = stores.get(name);
              if (method === 'get') request.result = table.get(input);
              if (method === 'put') table.set(input.scope ?? input.owner, input);
              if (method === 'delete') table.delete(input);
              request.onsuccess?.();
              queueMicrotask(() => tx.oncomplete?.());
            } catch (error) {
              tx.error = error;
              tx.onerror?.();
            }
          });
          return request;
        };
        return {
          get: (value) => execute('get', value),
          put: (value) => execute('put', value),
          delete: (value) => execute('delete', value),
        };
      };
      return tx;
    },
  };
  const indexedDB = {
    open() {
      const req = { result: db, onsuccess: null, onupgradeneeded: null, onerror: null };
      queueMicrotask(() => {
        if (!stores.has('keys')) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  return { indexedDB, stores };
}

test('wizard clinical drafts remain AES-GCM ciphertext and survive a new runtime', async () => {
  const { indexedDB, stores } = fakeIndexedDB();
  const first = createEncryptedWizardDraftStore({ indexedDB, crypto: webcrypto });
  const key = first.scope('profissional-1', 'mae-1', { encounterId: 'consulta-1' });
  const payload = {
    schema: 1, motherId: 'mae-1', encounterId: 'consulta-1', tag: 'draft-1', revision: 1, wizardStep: 4,
    babyTarget: 'bebe-1',
    state: { chief_complaint: { notes: 'Texto clínico sensível fictício' }, baby_assessment: { byBaby: { 'bebe-1': { notes: 'Bebê ativo' } } } },
  };
  await first.write(key, payload);
  const rows = [...stores.get('drafts').values()];
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes('Texto clínico sensível fictício'), false);
  assert.deepEqual(await createEncryptedWizardDraftStore({ indexedDB, crypto: webcrypto }).read(key), payload);
  assert.equal(stores.get('keys').get('profissional-1').key.extractable, false);
});

test('wizard local drafts are scoped by user, patient and encounter; deleting older version never removes new edits', async () => {
  const { indexedDB } = fakeIndexedDB();
  const store = createEncryptedWizardDraftStore({ indexedDB, crypto: webcrypto });
  const key = store.scope('prof-a', 'mother-a', { encounterId: 'encounter-x' });
  const first = { tag: 'a', revision: 1, state: { care_plan: { instructions: 'Primeira revisão' } } };
  const second = { tag: 'a', revision: 2, state: { care_plan: { instructions: 'Revisão mais recente' } } };
  const writes = [store.write(key, first), store.write(key, second)];
  await Promise.all(writes);
  assert.deepEqual(await store.read(key), second);
  assert.equal(await store.clear(key, first), false);
  assert.deepEqual(await store.read(key), second);
  assert.equal(await store.read(store.scope('prof-b', 'mother-a', { encounterId: 'encounter-x' })), null);
  assert.equal(await store.read(store.scope('prof-a', 'mother-b', { encounterId: 'encounter-x' })), null);
  assert.equal(await store.read(store.scope('prof-a', 'mother-a', { encounterId: 'encounter-y' })), null);
  assert.equal(await store.clear(key, second), true);
  assert.equal(await store.read(key), null);
});

test('wizard local drafts expire after 14 days and storage failure is visible', async () => {
  const { indexedDB } = fakeIndexedDB();
  let current = 1000;
  const store = createEncryptedWizardDraftStore({ indexedDB, crypto: webcrypto, now: () => current });
  const key = store.scope('prof', 'mother');
  await store.write(key, { tag: 'x', state: {} });
  current += 15 * 24 * 60 * 60 * 1000;
  assert.equal(await store.read(key), null);
  await assert.rejects(
    createEncryptedWizardDraftStore({ indexedDB: null, crypto: webcrypto }).write(key, { state: {} }),
    /Armazenamento criptografado indisponível/,
  );
  assert.throws(() => store.scope('', 'mother'), /Profissional e paciente/);
});
