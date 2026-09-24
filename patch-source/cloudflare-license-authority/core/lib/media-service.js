const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function extFrom(file) {
  const name = String(file?.name || 'arquivo').toLowerCase();
  const part = name.includes('.') ? name.split('.').pop() : '';
  if (/^[a-z0-9]{1,8}$/.test(part)) return part;
  return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'})[file?.type] || 'bin';
}

function safePart(value, fallback = 'media') {
  const clean = String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/-+/g, '-').slice(0, 120);
  return clean || fallback;
}

export function hasClinicalMediaConsent(consents = []) {
  return consents.some((item) => item?.consent_type === 'clinical_media' && item?.granted === true && !item?.revoked_at);
}

export function validateClinicalMedia(file, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (!file) throw new Error('Selecione um arquivo.');
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('Formato não permitido. Use JPG, PNG, WebP ou PDF.');
  if (Number(file.size || 0) > maxBytes) throw new Error('O arquivo deve ter no máximo 8 MB.');
  return true;
}

export function createMediaService(client, {
  bucket = 'clinical-media',
  now = () => Date.now(),
  random = () => Math.random().toString(36).slice(2, 10)
} = {}) {
  if (!client?.storageRequest || !client?.workerRequest) throw new Error('Cliente clínico é obrigatório.');
  const operations = new WeakMap();

  function uploadOperation({ file, ownerId, motherId, encounterId }) {
    const existing = file && typeof file === 'object' ? operations.get(file) : null;
    if (existing) return existing;
    const operationKey = safePart(`wizard-${encounterId || motherId || 'media'}-${now()}-${random()}`);
    const safeMother = safePart(motherId, 'sem-mae');
    const safeEncounter = safePart(encounterId, 'sem-atendimento');
    const path = `${safePart(ownerId, 'sem-usuario')}/${safeMother}/${safeEncounter}/${operationKey}.${extFrom(file)}`;
    const operation = { operationKey, path };
    if (file && typeof file === 'object') operations.set(file, operation);
    return operation;
  }

  async function upload({ file, ownerId, motherId = null, babyId = null, encounterId = null, appointmentId = null, consents = [], caption = '', side = '' }) {
    if (!ownerId) throw new Error('Usuária autenticada não identificada.');
    if (!hasClinicalMediaConsent(consents)) throw new Error('Consentimento para mídia clínica não concedido.');
    validateClinicalMedia(file);
    const { operationKey, path } = uploadOperation({ file, ownerId, motherId, encounterId });

    await client.storageRequest(`object/${bucket}/${path}`, {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': file.type,
        'x-upsert': 'false',
        'x-clinical-media-operation': operationKey
      }
    });

    const confirmed = await client.workerRequest('/api/clinical/media/confirm', {
      method: 'POST',
      body: {
        operation_key: operationKey,
        storage_path: path,
        mother_id: motherId,
        baby_id: babyId,
        appointment_id: appointmentId,
        encounter_id: encounterId,
        mime_type: file.type,
        file_name: file.name || `arquivo.${extFrom(file)}`,
        file_size: Number(file.size || 0),
        category: side || 'Outro',
        caption,
        taken_at: new Date(now()).toISOString()
      }
    });
    return confirmed?.media || confirmed;
  }

  async function createSignedUrl(path, expiresIn = 300) {
    const data = await client.storageRequest(`object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn })
    });
    return data?.signedURL || data?.signedUrl || null;
  }

  return { upload, createSignedUrl };
}
