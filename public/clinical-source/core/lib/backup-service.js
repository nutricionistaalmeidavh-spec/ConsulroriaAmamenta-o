const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TABLES = ['mothers','babies','appointments','clinical_encounters','weights','followups','financial_entries','consents','library_items','media'];
const ITERATIONS = 180000;

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error('Criptografia segura indisponível neste navegador.');
  if (String(passphrase || '').length < 6) throw new Error('Use uma senha de backup com pelo menos 6 caracteres.');
  const material = await cryptoImpl.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return cryptoImpl.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt','decrypt']
  );
}

export async function encryptBackup(payload, passphrase, { cryptoImpl = globalThis.crypto } = {}) {
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, cryptoImpl);
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    format: 'debora-lactacao-backup',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptBackup(envelope, passphrase, { cryptoImpl = globalThis.crypto } = {}) {
  if (envelope?.format !== 'debora-lactacao-backup' || envelope?.version !== 1) throw new Error('Arquivo de backup inválido.');
  try {
    const salt = fromBase64(envelope.salt);
    const iv = fromBase64(envelope.iv);
    const ciphertext = fromBase64(envelope.ciphertext);
    const key = await deriveKey(passphrase, salt, cryptoImpl);
    const clear = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return JSON.parse(decoder.decode(clear));
  } catch (error) {
    if (/pelo menos 6/.test(error?.message || '')) throw error;
    throw new Error('Senha do backup incorreta ou arquivo corrompido.');
  }
}

export function createBackupService(client, { now = () => new Date().toISOString() } = {}) {
  if (!client) throw new Error('Cliente de dados é obrigatório.');

  async function exportAll() {
    const data = {};
    for (const table of TABLES) data[table] = await client.rest(table, { query: 'select=*' });
    return { version: 1, exportedAt: now(), data };
  }

  async function restoreAll(backup) {
    if (!backup?.data || backup?.version !== 1) throw new Error('Backup incompatível.');
    for (const table of TABLES) {
      const rows = Array.isArray(backup.data[table]) ? backup.data[table] : [];
      if (!rows.length) continue;
      await client.rest(table, {
        method: 'POST',
        query: 'on_conflict=id',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: rows
      });
    }
  }

  return { exportAll, restoreAll, encryptBackup, decryptBackup };
}

export { TABLES as backupTables };
