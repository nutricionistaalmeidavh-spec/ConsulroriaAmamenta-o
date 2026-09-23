import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const storageSource = readFileSync('worker/storage-consistency-runtime.js', 'utf8');
const documentsSource = readFileSync('public/documents-feature.js', 'utf8');
const patientSource = readFileSync('public/clinical-source/features/patient-fixes.js', 'utf8');
const albumSource = readFileSync('public/album-feature.js', 'utf8');

async function authHeaders(runtime) {
  const session = await runtime.login(credentials.email);
  return {
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };
}

async function seed(db, table, id, record, ownerId = userId) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
  return row;
}

async function storageRow(db, bucket, path) {
  return db.prepare(`SELECT source_bucket,source_path,r2_key,size_bytes,mime_type,metadata_json
    FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1`).bind(bucket, path).first();
}

async function clinicalMediaRows(db) {
  const result = await db.prepare("SELECT record_key,record_json FROM supabase_records WHERE table_name='clinical_media'").all();
  return (result.results || []).map((row) => ({ key: row.record_key, ...JSON.parse(row.record_json) }));
}

function fileUrl(path) {
  return `http://localhost/api/files/object/clinical-media/${path.split('/').map(encodeURIComponent).join('/')}`;
}

test('R17 signed URL route is not intercepted as a storage mutation bucket named sign', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  const path = `${userId}/delivery5/signed-proof.pdf`;

  const upload = await runtime.mf.dispatchFetch(fileUrl(path), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/pdf', 'x-storage-operation': 'signed-proof-upload' },
    body: new Uint8Array([37, 80, 68, 70]),
  });
  assert.equal(upload.status, 200);

  const sign = await runtime.mf.dispatchFetch(
    `http://localhost/api/files/object/sign/clinical-media/${path.split('/').map(encodeURIComponent).join('/')}`,
    { method: 'POST', headers, body: JSON.stringify({ expiresIn: 900 }) },
  );
  assert.equal(sign.status, 200);
  const signed = await sign.json();
  assert.match(signed.signedURL, /^\/api\/files\/object\/clinical-media\//);

  const download = await runtime.mf.dispatchFetch(`http://localhost${signed.signedURL}`);
  assert.equal(download.status, 200);
  assert.deepEqual([...new Uint8Array(await download.arrayBuffer())], [37, 80, 68, 70]);
});

test('C03 clinical media upload has a retry-safe pending operation and confirm is idempotent', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'mother-media', { name: 'Mãe mídia' });
  await seed(runtime.db, 'babies', 'baby-media', { mother_id: 'mother-media', name: 'Bebê mídia' });

  const operationKey = '11111111-2222-4333-8444-555555555555';
  const path = `${userId}/patient-album/mother-media/${operationKey}-foto.jpg`;
  const uploadHeaders = {
    ...headers,
    'content-type': 'image/jpeg',
    'x-clinical-media-operation': operationKey,
  };
  const upload = () => runtime.mf.dispatchFetch(fileUrl(path), {
    method: 'POST', headers: uploadHeaders, body: new Uint8Array([1, 2, 3, 4]),
  });

  const first = await upload();
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.operation_id, operationKey);
  assert.equal(firstPayload.pending, true);

  const firstStorage = await storageRow(runtime.db, 'clinical-media', path);
  assert.ok(firstStorage?.r2_key);
  const firstMeta = JSON.parse(firstStorage.metadata_json || '{}');
  assert.equal(firstMeta.state, 'pending');
  assert.equal(firstMeta.operation_id, operationKey);
  assert.equal(firstMeta.owner_id, userId);
  assert.equal((await clinicalMediaRows(runtime.db)).length, 0, 'upload alone must not pretend the clinical link exists');

  const retry = await upload();
  assert.equal(retry.status, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.idempotent, true);
  const retriedStorage = await storageRow(runtime.db, 'clinical-media', path);
  assert.equal(retriedStorage.r2_key, firstStorage.r2_key, 'same operation retry must reuse the committed immutable object');

  const confirmBody = {
    operation_key: operationKey,
    storage_path: path,
    mother_id: 'mother-media',
    baby_id: 'baby-media',
    appointment_id: null,
    encounter_id: null,
    mime_type: 'image/jpeg',
    file_name: 'foto.jpg',
    file_size: 4,
    category: 'Evolução',
    caption: 'Registro de teste',
    taken_at: '2026-09-23T18:00:00.000Z',
  };
  const confirm = () => runtime.mf.dispatchFetch('http://localhost/api/clinical/media/confirm', {
    method: 'POST', headers, body: JSON.stringify(confirmBody),
  });

  const confirmed = await confirm();
  assert.equal(confirmed.status, 200);
  const confirmedPayload = await confirmed.json();
  assert.equal(confirmedPayload.media.id, operationKey);
  assert.equal(confirmedPayload.idempotent, false);
  assert.equal((await clinicalMediaRows(runtime.db)).length, 1);
  const confirmedStorage = await storageRow(runtime.db, 'clinical-media', path);
  const confirmedMeta = JSON.parse(confirmedStorage.metadata_json || '{}');
  assert.equal(confirmedMeta.state, 'confirmed');
  assert.equal(confirmedMeta.media_id, operationKey);

  const replay = await confirm();
  assert.equal(replay.status, 200);
  const replayPayload = await replay.json();
  assert.equal(replayPayload.idempotent, true);
  assert.equal(replayPayload.media.id, operationKey);
  assert.equal((await clinicalMediaRows(runtime.db)).length, 1, 'confirm retry must not create a second clinical row');
});

test('C03 stale pending clinical upload can be reconciled without touching confirmed media', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  const operationKey = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const path = `${userId}/patient-album/stale/${operationKey}.jpg`;

  const uploaded = await runtime.mf.dispatchFetch(fileUrl(path), {
    method: 'POST',
    headers: { ...headers, 'content-type': 'image/jpeg', 'x-clinical-media-operation': operationKey },
    body: new Uint8Array([9, 8, 7]),
  });
  assert.equal(uploaded.status, 200);
  const current = await storageRow(runtime.db, 'clinical-media', path);
  const meta = JSON.parse(current.metadata_json || '{}');
  meta.pending_at = '2020-01-01T00:00:00.000Z';
  await runtime.db.prepare('UPDATE storage_objects SET metadata_json=? WHERE source_bucket=? AND source_path=?')
    .bind(JSON.stringify(meta), 'clinical-media', path).run();

  const reconciled = await runtime.mf.dispatchFetch('http://localhost/api/clinical/media/reconcile', {
    method: 'POST', headers, body: JSON.stringify({ max_age_seconds: 3600 }),
  });
  assert.equal(reconciled.status, 200);
  const payload = await reconciled.json();
  assert.equal(payload.cleaned, 1);
  assert.equal(await storageRow(runtime.db, 'clinical-media', path), null);
});

test('C11 storage mutation uses immutable operation objects and conditional metadata deletion', () => {
  assert.match(storageSource, /x-storage-operation/);
  assert.match(storageSource, /immutableStorageKey/);
  assert.match(storageSource, /operation_id/);
  assert.match(storageSource, /DELETE FROM storage_objects[\s\S]*r2_key\s*=\s*\?/);
  assert.doesNotMatch(storageSource, /compensateMetadata/);
});

test('C04 signed file consumers accept the canonical /api/files URL without double prefixing', () => {
  assert.match(documentsSource, /resolveSignedFileUrl/);
  assert.doesNotMatch(documentsSource, /\/storage\/v1\$\{signed/);
  assert.match(patientSource, /pfResolveSignedUrl/);
  assert.doesNotMatch(patientSource, /PF_SB\+'\/api\/files'\+\(u/);
});

test('C05 patient photo reference is server-backed, expiry-aware in memory and patient-targeted', () => {
  assert.match(patientSource, /profile_photo_path/);
  assert.match(patientSource, /pfPhotoUrlCache/);
  assert.match(patientSource, /expiresAt/);
  assert.match(patientSource, /\[data-screen="patient"\][^\n]*\[data-patient-avatar\]/);
  assert.doesNotMatch(patientSource, /localStorage\.setItem\('pf-photo-path-/);
  assert.doesNotMatch(patientSource, /sessionStorage\.setItem\(key,u\)/);
});

test('C03 album uses one stable operation key and server confirm instead of manual delete compensation', () => {
  assert.match(albumSource, /operationKey/);
  assert.match(albumSource, /confirmClinicalMedia/);
  assert.doesNotMatch(albumSource, /deleteClinicalMedia\(storagePath\)\.catch/);
});
