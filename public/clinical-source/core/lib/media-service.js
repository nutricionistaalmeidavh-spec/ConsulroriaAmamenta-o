const ALLOWED_TYPES = new Set(['image/jpeg','image/png','image/webp','application/pdf']);
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

function extFrom(file) {
  const name = String(file?.name || 'arquivo').toLowerCase();
  const part = name.includes('.') ? name.split('.').pop() : '';
  if (/^[a-z0-9]{1,8}$/.test(part)) return part;
  return ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','application/pdf':'pdf'})[file?.type] || 'bin';
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
  if (!client) throw new Error('Cliente Supabase é obrigatório.');

  async function upload({ file, ownerId, motherId = null, babyId = null, encounterId = null, consents = [], caption = '', side = '' }) {
    if (!ownerId) throw new Error('Usuária autenticada não identificada.');
    if (!hasClinicalMediaConsent(consents)) throw new Error('Consentimento para mídia clínica não concedido.');
    validateClinicalMedia(file);
    const safeMother = motherId || 'sem-mae';
    const safeEncounter = encounterId || 'sem-atendimento';
    const path = `${ownerId}/${safeMother}/${safeEncounter}/${now()}-${random()}.${extFrom(file)}`;
    await client.storageRequest(`object/${bucket}/${path}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type, 'x-upsert': 'false' }
    });
    const rows = await client.rest('media', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        owner_id: ownerId,
        mother_id: motherId,
        baby_id: babyId,
        encounter_id: encounterId,
        storage_path: path,
        mime_type: file.type,
        media_kind: file.type === 'application/pdf' ? 'clinical_document' : 'clinical_photo',
        side,
        caption,
        consent_type: 'clinical_media'
      }
    });
    return Array.isArray(rows) ? rows[0] : rows;
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
