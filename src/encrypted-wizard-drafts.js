// Browser-local safety copy. The D1 clinical encounter is always the authoritative record.
// Ciphertext and a per-account non-extractable CryptoKey are persisted in separate IndexedDB stores.
const DATABASE = 'gestao-amamentacao-wizard-drafts-v1';
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export function createEncryptedWizardDraftStore({
  indexedDB = globalThis.indexedDB,
  crypto = globalThis.crypto,
  now = () => Date.now(),
} = {}) {
  let databasePromise = null;
  let tail = Promise.resolve();
  const keys = new Map();

  function scope(ownerId, motherId, { encounterId = null, appointmentId = null } = {}) {
    if (!ownerId || !motherId) throw new Error('Profissional e paciente são obrigatórios para salvar a cópia local.');
    const suffix = encounterId ? `encounter:${encounterId}` : appointmentId ? `appointment:${appointmentId}` : 'new';
    return JSON.stringify([String(ownerId), String(motherId), suffix]);
  }

  function open() {
    if (!indexedDB || !crypto?.subtle || !crypto?.getRandomValues) {
      return Promise.reject(new Error('Armazenamento criptografado indisponível neste navegador.'));
    }
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'owner' });
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'scope' });
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); databasePromise = null; keys.clear(); };
          resolve(db);
        };
        request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
        request.onblocked = () => reject(new Error('Armazenamento local bloqueado por outra janela.'));
      }).catch((error) => { databasePromise = null; throw error; });
    }
    return databasePromise;
  }

  function transaction(db, store, operation, arg) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, operation === 'get' ? 'readonly' : 'readwrite');
      const request = tx.objectStore(store)[operation](arg);
      let result;
      request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('Erro ao acessar o rascunho local.'));
      tx.onabort = () => reject(tx.error || new Error('Gravação do rascunho interrompida.'));
    });
  }

  function queue(work) {
    const next = tail.catch(() => undefined).then(work);
    tail = next;
    return next;
  }

  async function accountKey(db, ownerId, create = false) {
    if (keys.has(ownerId)) return keys.get(ownerId);
    let row = await transaction(db, 'keys', 'get', ownerId);
    if (!row && create) {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      row = { owner: ownerId, key };
      await transaction(db, 'keys', 'put', row);
    }
    if (row?.key) keys.set(ownerId, row.key);
    return row?.key || null;
  }

  async function decrypt(db, key, row) {
    const ownerId = JSON.parse(key)[0];
    const secret = await accountKey(db, ownerId);
    if (!secret) throw new Error('A chave criptográfica deste rascunho não está disponível.');
    const encoded = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: new Uint8Array(row.iv),
      additionalData: new TextEncoder().encode(key),
    }, secret, new Uint8Array(row.ciphertext));
    const parsed = JSON.parse(new TextDecoder().decode(encoded));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Rascunho local inválido.');
    return parsed;
  }

  async function write(key, payload) {
    // Queue writes to prevent an older async encryption from winning over newer edits.
    return queue(async () => {
      const db = await open();
      const ownerId = JSON.parse(key)[0];
      const secret = await accountKey(db, ownerId, true);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = await crypto.subtle.encrypt({
        name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(key),
      }, secret, new TextEncoder().encode(JSON.stringify(payload)));
      await transaction(db, 'drafts', 'put', {
        scope: key,
        savedAt: now(),
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(encoded)),
      });
      return payload;
    });
  }

  async function read(key) {
    await tail.catch(() => undefined);
    const db = await open();
    const row = await transaction(db, 'drafts', 'get', key);
    if (!row) return null;
    if (now() - Number(row.savedAt || 0) > RETENTION_MS) {
      await clear(key).catch(() => undefined);
      return null;
    }
    return decrypt(db, key, row);
  }

  async function clear(key, expected = null) {
    return queue(async () => {
      const db = await open();
      const row = await transaction(db, 'drafts', 'get', key);
      if (!row) return false;
      if (expected !== null) {
        const current = await decrypt(db, key, row);
        if (JSON.stringify(current) !== JSON.stringify(expected)) return false;
      }
      await transaction(db, 'drafts', 'delete', key);
      return true;
    });
  }

  return { scope, write, read, clear };
}
