import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(ROOT, path), 'utf8');

const MIGRATION = 'cloudflare/migrations/0006-clinical-d1-hardening.sql';

test('Block 9 ships an additive D1 hardening migration', () => {
  assert.equal(existsSync(resolve(ROOT, MIGRATION)), true, 'Block 9 migration must exist');
  const sql = read(MIGRATION);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS clinical_idempotency_keys/i);
  assert.match(sql, /UNIQUE\s*\(owner_id\s*,\s*operation\s*,\s*idempotency_key\)/i);
  assert.match(sql, /supabase_records_owner_id_idx|supabase_records_owner_record_idx/i);
  assert.match(sql, /json_extract\(record_json\s*,\s*'\$\.mother_id'\)/i);
  assert.match(sql, /json_extract\(record_json\s*,\s*'\$\.baby_id'\)/i);
  assert.match(sql, /UPDATE\s+supabase_records[\s\S]+owner_id\s+IS\s+NULL/i);
});

test('runtime schemas include Block 9 idempotency and owner/filter indexes', () => {
  for (const path of ['cloudflare/full-migration-schema.sql', 'cloudflare/runtime-schema.sql']) {
    const sql = read(path);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS clinical_idempotency_keys/i, `${path} missing idempotency table`);
    assert.match(sql, /supabase_records_owner_record_idx/i, `${path} missing owner record index`);
    assert.match(sql, /supabase_records_owner_mother_idx/i, `${path} missing mother filter index`);
    assert.match(sql, /supabase_records_owner_baby_idx/i, `${path} missing baby filter index`);
  }
});

test('high-value clinical writes use the shared owner-scoped D1 record store', () => {
  const storePath = resolve(ROOT, 'worker/d1-record-store.js');
  assert.equal(existsSync(storePath), true, 'shared D1 record store must exist');

  for (const path of [
    'worker/cloudflare-upsert-runtime.js',
    'worker/cloudflare-growth-runtime.js',
    'worker/patient-write-runtime.js',
  ]) {
    const source = read(path);
    assert.match(source, /from ['"]\.\/d1-record-store\.js['"]/, `${path} must use the shared owner-scoped store`);
    assert.doesNotMatch(
      source,
      /SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?/,
      `${path} must not load an entire table before applying owner scope`,
    );
  }
});

test('the shared store filters by owner and refuses cross-owner conflict updates', async () => {
  const storePath = resolve(ROOT, 'worker/d1-record-store.js');
  assert.equal(existsSync(storePath), true, 'shared D1 record store must exist');
  const store = await import(`../worker/d1-record-store.js?block9=${Date.now()}`);

  const calls = [];
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          calls.push({ sql, args });
          return {
            async all() { return { results: [] }; },
            async first() { return null; },
            async run() { return { success: true, meta: { changes: 1 } }; },
          };
        },
      };
    },
  };

  await store.ownerRows(db, 'mothers', 'owner-a');
  assert.match(calls.at(-1).sql, /WHERE table_name = \? AND owner_id = \?/i);
  assert.deepEqual(calls.at(-1).args, ['mothers', 'owner-a']);

  const statement = store.guardedRecordStatement(db, 'mothers', 'mother-1', {
    id: 'mother-1', owner_id: 'owner-a', name: 'Paciente',
  }, 'owner-a', '2026-09-23T00:00:00.000Z');
  await statement.run();
  const sql = calls.at(-1).sql;
  assert.match(sql, /ON CONFLICT\(table_name,record_key\) DO UPDATE SET/i);
  assert.match(sql, /WHERE supabase_records\.owner_id IS NULL OR supabase_records\.owner_id = excluded\.owner_id/i);
});

test('patient and growth writes expose request idempotency without weakening transactional batches', () => {
  const patient = read('worker/patient-write-runtime.js');
  const growth = read('worker/cloudflare-growth-runtime.js');

  assert.match(patient, /idempotency/i);
  assert.match(patient, /db\.batch\(statements\)/);
  assert.match(growth, /idempotency/i);
  assert.match(growth, /db\.batch\(statements\)/);
});
