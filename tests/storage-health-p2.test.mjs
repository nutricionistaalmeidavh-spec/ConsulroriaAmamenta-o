import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

function authHeader(session) {
  return { authorization: `Bearer ${session.access_token}` };
}

function fixedBody(text) {
  const bytes = new TextEncoder().encode(text);
  return {
    body: bytes,
    headers: { 'content-type': 'text/plain', 'content-length': String(bytes.byteLength) },
  };
}

async function objectExists(runtime, key) {
  const bucket = await runtime.mf.getR2Bucket('CLINICAL_FILES');
  return Boolean(await bucket.get(key));
}

async function objectCount(runtime, prefix) {
  const bucket = await runtime.mf.getR2Bucket('CLINICAL_FILES');
  const result = await bucket.list({ prefix });
  return result.objects.length;
}

async function storageRow(runtime, bucket, path) {
  return runtime.db.prepare(
    'SELECT source_bucket,source_path,r2_key,size_bytes,mime_type FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1',
  ).bind(bucket, path).first();
}

test('failed D1 metadata write compensates only the immutable R2 object created by that upload', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const session = await runtime.login();
  const bucket = 'clinical-media';
  const path = `${userId}/p2-upload-consistency.txt`;
  const immutablePrefix = `supabase/.objects/${bucket}/${encodeURIComponent(path)}/`;
  const upload = fixedBody('P2 upload payload');

  await runtime.db.prepare(`CREATE TRIGGER fail_storage_metadata_insert_p2
    BEFORE INSERT ON storage_objects
    BEGIN SELECT RAISE(ABORT, 'forced_storage_metadata_failure_p2'); END`).run();

  const response = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeader(session), ...upload.headers },
    body: upload.body,
  });

  assert.equal(response.status, 500);
  assert.equal(await objectCount(runtime, immutablePrefix), 0, 'failed metadata write must not leave its immutable R2 object orphaned');
  assert.equal(await storageRow(runtime, bucket, path), null);
});

test('failed D1 metadata delete preserves the exact current R2 object and metadata', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const session = await runtime.login();
  const bucket = 'clinical-media';
  const path = `${userId}/p2-delete-consistency.txt`;
  const upload = fixedBody('P2 delete payload');

  const uploaded = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeader(session), ...upload.headers, 'x-storage-operation': 'p2-delete-upload' },
    body: upload.body,
  });
  assert.equal(uploaded.status, 200);
  const before = await storageRow(runtime, bucket, path);
  assert.ok(before?.r2_key);
  assert.equal(await objectExists(runtime, before.r2_key), true);

  await runtime.db.prepare(`CREATE TRIGGER fail_storage_metadata_delete_p2
    BEFORE DELETE ON storage_objects
    BEGIN SELECT RAISE(ABORT, 'forced_storage_delete_failure_p2'); END`).run();

  const deleted = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(deleted.status, 500);
  assert.equal(await objectExists(runtime, before.r2_key), true, 'failed metadata delete must not remove the exact current R2 object');
  const after = await storageRow(runtime, bucket, path);
  assert.ok(after, 'metadata must remain when delete claim transaction fails');
  assert.equal(after.r2_key, before.r2_key);
});

test('public health exposes only availability and deployed git SHA', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());

  const response = await runtime.mf.dispatchFetch('http://localhost/api/cloudflare/health');
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.deepEqual(Object.keys(body).sort(), ['gitSha', 'ok']);
  assert.equal(typeof body.ok, 'boolean');
  assert.equal(typeof body.gitSha, 'string');
  for (const forbidden of ['backend', 'd1', 'r2', 'authSecret', 'validatedMigrations', 'authUsers', 'records', 'externalClinicalWrites']) {
    assert.equal(forbidden in body, false, `health must not expose ${forbidden}`);
  }
});
