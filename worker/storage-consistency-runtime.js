import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-data-runtime.js';
import { validateRelationalRow } from './relational-integrity-runtime.js';

const CLINICAL_BUCKET = 'clinical-media';
const CLINICAL_CONFIRM_PATH = '/api/clinical/media/confirm';
const CLINICAL_RECONCILE_PATH = '/api/clinical/media/reconcile';
const SIGN_PREFIX = '/api/files/object/sign/';

function legacyStorageKey(bucket, path) {
  return `supabase/${bucket}/${path}`;
}

function safeOperationId(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9._:-]/g, '').slice(0, 160);
}

function immutableStorageKey(bucket, path, operationId) {
  const cleanOperation = safeOperationId(operationId) || crypto.randomUUID();
  return `supabase/.objects/${bucket}/${encodeURIComponent(path)}/${cleanOperation}`;
}

function parseMetadata(row) {
  try { return JSON.parse(row?.metadata_json || '{}'); } catch { return {}; }
}

function mutationTarget(request, url) {
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return null;

  if (url.pathname === '/api/clinical/media/upload' && request.method === 'POST') {
    const path = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    return path ? { bucket: CLINICAL_BUCKET, path } : null;
  }

  // Signing is a read-capability operation even though the endpoint uses POST.
  // It must reach the file signing handler instead of being interpreted as bucket "sign".
  if (url.pathname.startsWith(SIGN_PREFIX)) return null;
  if (!url.pathname.startsWith('/api/files/object/')) return null;
  const relative = url.pathname.slice('/api/files/object/'.length);
  const [bucketEncoded, ...pathParts] = relative.split('/');
  const bucket = decodeURIComponent(bucketEncoded || '');
  const path = pathParts.map(decodeURIComponent).join('/');
  return bucket && path ? { bucket, path } : null;
}

async function resolveMediaAccess(env, user) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) return null;
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET },
    body: JSON.stringify({ action: 'resolve', productCode: 'debora-lactacao', email: user.email }),
  }));
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

async function assertMediaAccess(env, user, contentType) {
  if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) return null;
  const access = await resolveMediaAccess(env, user);
  return access?.commercial && !access.mediaUpload
    ? runtimeJson(403, { error: 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED' })
    : null;
}

async function metadataRow(db, bucket, path) {
  return db.prepare(`SELECT
      source_bucket,source_path,r2_key,size_bytes,mime_type,
      source_created_at,source_updated_at,metadata_json,migrated_at
    FROM storage_objects
    WHERE source_bucket=? AND source_path=?
    LIMIT 1`)
    .bind(bucket, path)
    .first();
}

function upsertMetadataStatement(db, {
  bucket,
  path,
  key,
  size,
  contentType,
  createdAt,
  updatedAt,
  metadataJson = '{}',
}) {
  return db.prepare(`INSERT INTO storage_objects(
      source_bucket,source_path,r2_key,size_bytes,mime_type,
      source_created_at,source_updated_at,metadata_json,migrated_at
    ) VALUES(?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(source_bucket,source_path) DO UPDATE SET
      r2_key=excluded.r2_key,
      size_bytes=excluded.size_bytes,
      mime_type=excluded.mime_type,
      source_updated_at=excluded.source_updated_at,
      metadata_json=excluded.metadata_json,
      migrated_at=CURRENT_TIMESTAMP`)
    .bind(bucket, path, key, size, contentType, createdAt, updatedAt, metadataJson);
}

function operationIdFor(request) {
  return safeOperationId(
    request.headers.get('x-clinical-media-operation')
      || request.headers.get('x-storage-operation')
      || crypto.randomUUID(),
  );
}

function clinicalOperationId(request) {
  return safeOperationId(request.headers.get('x-clinical-media-operation'));
}

async function upload(request, env, user, { bucket, path }) {
  const db = env.CLINICAL_DB;
  const r2 = env.CLINICAL_FILES;
  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  const denied = await assertMediaAccess(env, user, contentType);
  if (denied) return denied;

  const operationId = operationIdFor(request);
  const pendingOperation = bucket === CLINICAL_BUCKET ? clinicalOperationId(request) : '';
  const previous = await metadataRow(db, bucket, path);
  const previousMeta = parseMetadata(previous);

  if (previous && previousMeta.operation_id === operationId) {
    return runtimeJson(200, {
      Key: previous.r2_key,
      path,
      operation_id: operationId,
      pending: previousMeta.state === 'pending',
      idempotent: true,
    });
  }

  const now = new Date().toISOString();
  const key = immutableStorageKey(bucket, path, operationId);
  const bytes = await request.arrayBuffer();
  const size = bytes.byteLength;
  const metadata = {
    operation_id: operationId,
    owner_id: user.id,
    ...(pendingOperation ? { state: 'pending', pending_at: now } : { state: 'committed' }),
  };

  // R2 receives an immutable operation object first. If D1 fails afterwards, only
  // this operation-specific object can be removed; no previous metadata is restored.
  try {
    await r2.put(key, bytes, { httpMetadata: { contentType } });
  } catch (error) {
    console.error('R2 immutable upload failed', error);
    return runtimeJson(500, { error: 'storage_object_write_failed' });
  }

  try {
    await upsertMetadataStatement(db, {
      bucket,
      path,
      key,
      size,
      contentType,
      createdAt: previous?.source_created_at || now,
      updatedAt: now,
      metadataJson: JSON.stringify(metadata),
    }).run();
  } catch (error) {
    await r2.delete(key).catch((cleanupError) => console.error('immutable storage cleanup failed', cleanupError));
    console.error('storage metadata write failed after immutable R2 upload', error);
    return runtimeJson(500, { error: 'storage_metadata_write_failed' });
  }

  if (previous?.r2_key && previous.r2_key !== key) {
    r2.delete(previous.r2_key).catch((error) => console.warn('previous immutable object cleanup deferred', error));
  }

  return runtimeJson(200, {
    Key: key,
    path,
    operation_id: operationId,
    pending: Boolean(pendingOperation),
    idempotent: false,
  });
}

async function remove(env, { bucket, path }) {
  const db = env.CLINICAL_DB;
  const r2 = env.CLINICAL_FILES;
  const previous = await metadataRow(db, bucket, path);
  const key = previous?.r2_key || legacyStorageKey(bucket, path);

  // Delete the exact object version first. Metadata removal is conditioned on the
  // same r2_key so a late delete can never erase a concurrent successful rewrite.
  try {
    await r2.delete(key);
  } catch (error) {
    console.error('storage object delete failed', error);
    return runtimeJson(500, { error: 'storage_object_delete_failed' });
  }

  if (previous) {
    try {
      await db.prepare(`DELETE FROM storage_objects
        WHERE source_bucket = ? AND source_path = ? AND r2_key = ?`)
        .bind(bucket, path, key)
        .run();
    } catch (error) {
      console.error('conditional storage metadata delete failed', error);
      return runtimeJson(500, { error: 'storage_metadata_delete_failed' });
    }
  }

  return new Response(null, { status: 204 });
}

async function existingClinicalMedia(db, ownerId, mediaId) {
  const row = await db.prepare(`SELECT record_key,owner_id,record_json
    FROM supabase_records
    WHERE table_name='clinical_media' AND owner_id=?
      AND (record_key=? OR json_extract(record_json,'$.id')=?)
    LIMIT 1`).bind(ownerId, mediaId, mediaId).first();
  if (!row) return null;
  try { return JSON.parse(row.record_json); } catch { return null; }
}

function clinicalMediaInsertStatement(db, userId, operationKey, media, storage) {
  const now = media.updated_at;
  return db.prepare(`INSERT INTO supabase_records(
      table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
    )
    SELECT 'clinical_media',?,?,?,?,?,?
    FROM storage_objects
    WHERE source_bucket=? AND source_path=? AND r2_key=?
      AND json_extract(metadata_json,'$.operation_id')=?
      AND json_extract(metadata_json,'$.owner_id')=?
    ON CONFLICT(table_name,record_key) DO NOTHING`).bind(
    operationKey,
    userId,
    JSON.stringify(media),
    media.created_at,
    now,
    now,
    CLINICAL_BUCKET,
    media.storage_path,
    storage.r2_key,
    operationKey,
    userId,
  );
}

function confirmMetadataStatement(db, userId, operationKey, storage, mediaId, now) {
  const currentMeta = parseMetadata(storage);
  const confirmed = JSON.stringify({
    ...currentMeta,
    operation_id: operationKey,
    owner_id: userId,
    state: 'confirmed',
    media_id: mediaId,
    confirmed_at: now,
  });
  return db.prepare(`UPDATE storage_objects SET
      metadata_json=?, source_updated_at=?, migrated_at=CURRENT_TIMESTAMP
    WHERE source_bucket=? AND source_path=? AND r2_key=?
      AND json_extract(metadata_json,'$.operation_id')=?
      AND json_extract(metadata_json,'$.owner_id')=?`).bind(
    confirmed,
    now,
    CLINICAL_BUCKET,
    storage.source_path,
    storage.r2_key,
    operationKey,
    userId,
  );
}

async function confirmClinicalMedia(request, env, user) {
  const input = await request.json().catch(() => ({}));
  const operationKey = safeOperationId(input?.operation_key);
  const storagePath = String(input?.storage_path || '').replace(/^\/+/, '');
  if (!operationKey || !storagePath) return runtimeJson(400, { error: 'clinical_media_operation_required' });
  if (!storagePath.startsWith(`${user.id}/`) || storagePath.includes('..')) {
    return runtimeJson(403, { error: 'clinical_media_outside_account' });
  }

  const existing = await existingClinicalMedia(env.CLINICAL_DB, user.id, operationKey);
  if (existing) {
    if (String(existing.storage_path || '') !== storagePath) {
      return runtimeJson(409, { error: 'clinical_media_operation_conflict' });
    }
    return runtimeJson(200, { media: existing, idempotent: true });
  }

  const storage = await metadataRow(env.CLINICAL_DB, CLINICAL_BUCKET, storagePath);
  const storageMeta = parseMetadata(storage);
  if (!storage || storageMeta.operation_id !== operationKey || storageMeta.owner_id !== user.id) {
    return runtimeJson(409, { error: 'clinical_media_pending_upload_not_found' });
  }

  const relationError = await validateRelationalRow(env, {
    mother_id: input.mother_id || null,
    baby_id: input.baby_id || null,
    appointment_id: input.appointment_id || null,
    encounter_id: input.encounter_id || null,
  }, user.id);
  if (relationError) return relationError;

  const now = new Date().toISOString();
  const media = {
    id: operationKey,
    owner_id: user.id,
    mother_id: input.mother_id || null,
    baby_id: input.baby_id || null,
    appointment_id: input.appointment_id || null,
    encounter_id: input.encounter_id || null,
    storage_path: storagePath,
    mime_type: input.mime_type || storage.mime_type || 'application/octet-stream',
    file_name: String(input.file_name || 'arquivo'),
    file_size: Number(input.file_size ?? storage.size_bytes ?? 0),
    category: String(input.category || 'Outro'),
    caption: String(input.caption || ''),
    taken_at: input.taken_at || now,
    upload_operation_id: operationKey,
    created_at: now,
    updated_at: now,
  };

  try {
    await env.CLINICAL_DB.batch([
      clinicalMediaInsertStatement(env.CLINICAL_DB, user.id, operationKey, media, storage),
      confirmMetadataStatement(env.CLINICAL_DB, user.id, operationKey, storage, operationKey, now),
    ]);
  } catch (error) {
    console.error('clinical media confirmation failed', error);
    return runtimeJson(500, { error: 'clinical_media_confirmation_failed' });
  }

  const confirmedMedia = await existingClinicalMedia(env.CLINICAL_DB, user.id, operationKey);
  const confirmedStorage = await metadataRow(env.CLINICAL_DB, CLINICAL_BUCKET, storagePath);
  const confirmedMeta = parseMetadata(confirmedStorage);
  if (!confirmedMedia || confirmedMeta.state !== 'confirmed' || confirmedMeta.media_id !== operationKey) {
    return runtimeJson(409, { error: 'clinical_media_confirmation_conflict' });
  }
  return runtimeJson(200, { media: confirmedMedia, idempotent: false });
}

async function reconcileClinicalMedia(request, env, user) {
  const input = await request.json().catch(() => ({}));
  const maxAgeSeconds = Math.max(60, Math.min(7 * 24 * 3600, Number(input?.max_age_seconds || 3600)));
  const cutoff = new Date(Date.now() - maxAgeSeconds * 1000).toISOString();
  const result = await env.CLINICAL_DB.prepare(`SELECT
      source_bucket,source_path,r2_key,size_bytes,mime_type,
      source_created_at,source_updated_at,metadata_json,migrated_at
    FROM storage_objects
    WHERE source_bucket=?
      AND json_extract(metadata_json,'$.state')='pending'
      AND json_extract(metadata_json,'$.owner_id')=?
      AND json_extract(metadata_json,'$.pending_at') < ?`)
    .bind(CLINICAL_BUCKET, user.id, cutoff)
    .all();

  let cleaned = 0;
  for (const row of result.results || []) {
    try {
      await env.CLINICAL_FILES.delete(row.r2_key);
      await env.CLINICAL_DB.prepare(`DELETE FROM storage_objects
        WHERE source_bucket = ? AND source_path = ? AND r2_key = ?
          AND json_extract(metadata_json,'$.state')='pending'
          AND json_extract(metadata_json,'$.owner_id')=?`)
        .bind(CLINICAL_BUCKET, row.source_path, row.r2_key, user.id)
        .run();
      if (!await metadataRow(env.CLINICAL_DB, CLINICAL_BUCKET, row.source_path)) cleaned += 1;
    } catch (error) {
      console.warn('pending clinical media reconciliation deferred', error);
    }
  }
  return runtimeJson(200, { cleaned });
}

export async function resolveStorageObjectKey(env, bucket, path) {
  if (!env?.CLINICAL_DB) return legacyStorageKey(bucket, path);
  const row = await metadataRow(env.CLINICAL_DB, bucket, path);
  return row?.r2_key || legacyStorageKey(bucket, path);
}

export async function handleConsistentStorageMutation(request, env, url = new URL(request.url)) {
  const clinicalControl = url.pathname === CLINICAL_CONFIRM_PATH || url.pathname === CLINICAL_RECONCILE_PATH;
  const target = mutationTarget(request, url);
  if (!target && !clinicalControl) return null;

  if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
  if (!env.CLINICAL_FILES) return runtimeJson(503, { message: 'R2 não configurado.' });

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada.' });

  if (url.pathname === CLINICAL_CONFIRM_PATH && request.method === 'POST') {
    return confirmClinicalMedia(request, env, user);
  }
  if (url.pathname === CLINICAL_RECONCILE_PATH && request.method === 'POST') {
    return reconcileClinicalMedia(request, env, user);
  }
  if (clinicalControl) return runtimeJson(405, { error: 'method_not_allowed' });

  if (!target.path || target.path.includes('..')) return runtimeJson(400, { message: 'Caminho inválido.' });
  if (!target.path.startsWith(`${user.id}/`)) {
    return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
  }

  return request.method === 'DELETE'
    ? remove(env, target)
    : upload(request, env, user, target);
}
