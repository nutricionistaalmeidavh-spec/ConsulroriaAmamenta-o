const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 180000;
const BACKUP_FORMAT = 'debora-lactacao-clinical-account-backup';
const BACKUP_VERSION = 2;
const BACKUP_TABLES = [
  'mothers','babies','appointments','appointment_babies','clinical_encounters','clinical_encounter_babies',
  'weights','growth_measurements','followups','financial_entries','consents','library_items','media','clinical_media',
  'clinical_document_templates','clinical_documents','clinical_encounter_addenda','clinical_note_revisions',
  'care_packages','care_package_items','care_package_sessions','care_package_item_usages','professional_profiles',
];

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
    payloadFormat: BACKUP_FORMAT,
    payloadVersion: BACKUP_VERSION,
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

function assertCurrentBackup(backup) {
  if (backup?.format === BACKUP_FORMAT && backup?.version === BACKUP_VERSION) return backup;
  if (backup?.version === 1 && backup?.data) {
    throw new Error('Este backup legado é incompleto e não pode ser restaurado automaticamente. Gere um novo backup completo nesta versão do sistema.');
  }
  throw new Error('Backup incompatível.');
}

export function createBackupService(client) {
  if (!client?.workerRequest) throw new Error('Cliente de dados é obrigatório.');

  async function exportAll() {
    const backup = await client.workerRequest('/api/clinical/backup/export');
    return assertCurrentBackup(backup);
  }

  async function restoreAll(backup) {
    assertCurrentBackup(backup);
    return client.workerRequest('/api/clinical/backup/restore', { method: 'POST', body: backup });
  }

  return { exportAll, restoreAll, encryptBackup, decryptBackup };
}

export { BACKUP_TABLES as backupTables, BACKUP_FORMAT as backupFormat, BACKUP_VERSION as backupVersion };
