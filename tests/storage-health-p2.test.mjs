import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

function authHeader(session) {
  return { authorization: `Bearer ${session.access_token}` };
}

async function objectExists(runtime, key) {
  const bucket = await runtime.mf.getR2Bucket('CLINICAL_FILES');
  return Boolean(await bucket.get(key));
}

async function storageRow(runtime, bucket, path) {
  return runtime.db.prepare(
    'SELECT source_bucket,source_path,r2_key,size_bytes,mime_type FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1',
  ).bind(bucket, path).first();
}

test('failed D1 metadata write compensates the R2 upload', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const session = await runtime.login();
  const bucket = 'clinical-media';
  const path = `${userId}/p2-upload-consistency.txt`;
  const key = `supabase/${bucket}/${path}`;

  await runtime.db.prepare(`CREATE TRIGGER fail_storage_metadata_insert_p2
    BEFORE INSERT ON storage_objects
    BEGIN SELECT RAISE(ABORT, 'forced_storage_metadata_failure_p2'); END`).run();

  const response = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeader(session), 'content-type': 'text/plain' },
    body: 'P2 upload payload',
  });

  assert.equal(response.status, 500);
  assert.equal(await objectExists(runtime, key), false, 'failed metadata write must not leave an orphan R2 object');
  assert.equal(await storageRow(runtime, bucket, path), null);
});

test('failed D1 metadata delete preserves the R2 object and metadata', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const session = await runtime.login();
  const bucket = 'clinical-media';
  const path = `${userId}/p2-delete-consistency.txt`;
  const key = `supabase/${bucket}/${path}`;

  const uploaded = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'POST',
    headers: { ...authHeader(session), 'content-type': 'text/plain' },
    body: 'P2 delete payload',
  });
  assert.equal(uploaded.status, 200);
  assert.equal(await objectExists(runtime, key), true);
  assert.ok(await storageRow(runtime, bucket, path));

  await runtime.db.prepare(`CREATE TRIGGER fail_storage_metadata_delete_p2
    BEFORE DELETE ON storage_objects
    BEGIN SELECT RAISE(ABORT, 'forced_storage_delete_failure_p2'); END`).run();

  const deleted = await runtime.mf.dispatchFetch(`http://localhost/api/files/object/${bucket}/${path}`, {
    method: 'DELETE',
    headers: authHeader(session),
  });

  assert.equal(deleted.status, 500);
  assert.equal(await objectExists(runtime, key), true, 'failed metadata delete must not remove the R2 object');
  assert.ok(await storageRow(runtime, bucket, path), 'metadata must remain when delete fails');
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
