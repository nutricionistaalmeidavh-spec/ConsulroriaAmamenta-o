import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-data-runtime.js';

function storageKey(bucket, path) {
  return `supabase/${bucket}/${path}`;
}

function mutationTarget(request, url) {
  if (!['POST', 'PUT', 'DELETE'].includes(request.method)) return null;

  if (url.pathname === '/api/clinical/media/upload' && request.method === 'POST') {
    const path = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
    return path ? { bucket: 'clinical-media', path } : null;
  }

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

async function restoreMetadata(db, previous) {
  if (!previous) return;
  await db.prepare(`INSERT INTO storage_objects(
      source_bucket,source_path,r2_key,size_bytes,mime_type,
      source_created_at,source_updated_at,metadata_json,migrated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_bucket,source_path) DO UPDATE SET
      r2_key=excluded.r2_key,
      size_bytes=excluded.size_bytes,
      mime_type=excluded.mime_type,
      source_created_at=excluded.source_created_at,
      source_updated_at=excluded.source_updated_at,
      metadata_json=excluded.metadata_json,
      migrated_at=excluded.migrated_at`)
    .bind(
      previous.source_bucket,
      previous.source_path,
      previous.r2_key,
      previous.size_bytes,
      previous.mime_type,
      previous.source_created_at,
      previous.source_updated_at,
      previous.metadata_json || '{}',
      previous.migrated_at,
    )
    .run();
}

async function compensateMetadata(db, previous, bucket, path) {
  if (previous) {
    await restoreMetadata(db, previous);
  } else {
    await db.prepare('DELETE FROM storage_objects WHERE source_bucket=? AND source_path=?')
      .bind(bucket, path)
      .run();
  }
}

async function upload(request, env, user, { bucket, path }) {
  const db = env.CLINICAL_DB;
  const r2 = env.CLINICAL_FILES;
  const contentType = request.headers.get('content-type') || 'application/octet-stream';
  const denied = await assertMediaAccess(env, user, contentType);
  if (denied) return denied;

  const previous = await metadataRow(db, bucket, path);
  const now = new Date().toISOString();
  const key = storageKey(bucket, path);
  const contentLength = Number(request.headers.get('content-length'));
  const size = Number.isFinite(contentLength) && contentLength >= 0 ? contentLength : null;

  // D1 is updated first. R2 PUT is atomic per object, so a failed PUT leaves the
  // previous object intact; metadata can then be compensated to its previous row.
  try {
    await upsertMetadataStatement(db, {
      bucket,
      path,
      key,
      size,
      contentType,
      createdAt: previous?.source_created_at || now,
      updatedAt: now,
      metadataJson: previous?.metadata_json || '{}',
    }).run();
  } catch (error) {
    console.error('storage metadata upsert failed before R2 write', error);
    return runtimeJson(500, { error: 'storage_metadata_write_failed' });
  }

  try {
    await r2.put(key, request.body, { httpMetadata: { contentType } });
  } catch (error) {
    try {
      await compensateMetadata(db, previous, bucket, path);
    } catch (rollbackError) {
      console.error('storage upload metadata compensation failed', rollbackError);
    }
    console.error('R2 upload failed after metadata write', error);
    return runtimeJson(500, { error: 'storage_object_write_failed' });
  }

  return runtimeJson(200, { Key: key, path });
}

async function remove(env, { bucket, path }) {
  const db = env.CLINICAL_DB;
  const r2 = env.CLINICAL_FILES;
  const previous = await metadataRow(db, bucket, path);

  // Delete metadata first. If D1 rejects the mutation, the R2 object is untouched.
  try {
    await db.prepare('DELETE FROM storage_objects WHERE source_bucket=? AND source_path=?')
      .bind(bucket, path)
      .run();
  } catch (error) {
    console.error('storage metadata delete failed before R2 delete', error);
    return runtimeJson(500, { error: 'storage_metadata_delete_failed' });
  }

  try {
    await r2.delete(storageKey(bucket, path));
  } catch (error) {
    try {
      await restoreMetadata(db, previous);
    } catch (rollbackError) {
      console.error('storage delete metadata compensation failed', rollbackError);
    }
    console.error('R2 delete failed after metadata delete', error);
    return runtimeJson(500, { error: 'storage_object_delete_failed' });
  }

  return new Response(null, { status: 204 });
}

export async function handleConsistentStorageMutation(request, env, url = new URL(request.url)) {
  const target = mutationTarget(request, url);
  if (!target) return null;

  if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
  if (!env.CLINICAL_FILES) return runtimeJson(503, { message: 'R2 não configurado.' });
  if (!target.path || target.path.includes('..')) return runtimeJson(400, { message: 'Caminho inválido.' });

  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required', message: 'Sessão expirada.' });
  if (!target.path.startsWith(`${user.id}/`)) {
    return runtimeJson(403, { message: 'Arquivo fora do escopo da conta.' });
  }

  return request.method === 'DELETE'
    ? remove(env, target)
    : upload(request, env, user, target);
}
