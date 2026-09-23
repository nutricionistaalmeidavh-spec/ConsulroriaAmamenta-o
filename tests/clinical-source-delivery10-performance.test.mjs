import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

function authHeaders(session) {
  return { authorization: `Bearer ${session.access_token}` };
}

async function seedEncounters(db, ownerId, prefix, count = 2000) {
  const chunk = 1000;
  for (let start = 1; start <= count; start += chunk) {
    const size = Math.min(chunk, count - start + 1);
    await db.prepare(`WITH RECURSIVE seq(x) AS (
      SELECT 0 UNION ALL SELECT x + 1 FROM seq WHERE x + 1 < ?
    )
    INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at)
    SELECT 'clinical_encounters', ? || (x + ?), ?,
      json_object(
        'id', ? || (x + ?),
        'owner_id', ?,
        'mother_id', 'perf-mother',
        'status', 'finalized',
        'occurred_at', printf('2026-09-%02dT12:%02d:%02d.000Z', ((x + ?) % 28) + 1, (x + ?) % 60, (x + ?) % 60)
      ),
      '2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z'
    FROM seq`)
      .bind(size, prefix, start, ownerId, prefix, start, ownerId, start, start, start)
      .run();
  }
}

test('C12 owned record page builder pushes owner, filter, order, limit and offset into D1 SQL', async () => {
  const store = await import('../worker/d1-record-store.js');
  assert.equal(typeof store.buildOwnedRecordPageQuery, 'function', 'C12 requires an SQL page builder in the record store');
  const url = new URL('http://localhost/api/clinical/records/clinical_encounters?mother_id=eq.perf-mother&order=occurred_at.desc&limit=25&offset=50');
  const built = store.buildOwnedRecordPageQuery('clinical_encounters', userId, url);
  assert.ok(built, 'representative encounter query must be SQL-pageable');
  assert.match(built.sql, /table_name\s*=\s*\?/i);
  assert.match(built.sql, /owner_id\s*=\s*\?/i);
  assert.match(built.sql, /json_extract\(record_json,'\$\.mother_id'\)\s*=\s*\?/i);
  assert.match(built.sql, /ORDER BY\s+json_extract\(record_json,'\$\.occurred_at'\)\s+DESC/i);
  assert.match(built.sql, /LIMIT\s+\?\s+OFFSET\s+\?/i);
  assert.equal(built.bindings.at(-2), 25);
  assert.equal(built.bindings.at(-1), 50);
});

test('C12 representative volume returns a bounded owner-scoped page with an exact total', async () => {
  const runtime = await createLocalRuntime();
  try {
    await seedEncounters(runtime.db, userId, 'perf-a-', 2000);
    await seedEncounters(runtime.db, 'audit-other', 'perf-b-', 2000);
    const session = await runtime.login();
    const response = await runtime.mf.dispatchFetch(
      'http://localhost/api/clinical/records/clinical_encounters?mother_id=eq.perf-mother&order=occurred_at.desc&limit=25&offset=0',
      { headers: authHeaders(session) },
    );
    assert.equal(response.status, 200);
    const rows = await response.json();
    assert.equal(rows.length, 25);
    assert.ok(rows.every((row) => row.owner_id === userId));
    assert.equal(response.headers.get('content-range'), '0-24/2000');
  } finally {
    await runtime.close();
  }
});

test('C12 package and member portal readers are owner-scoped in SQL instead of table-wide scans', () => {
  const packageSource = readFileSync(new URL('../worker/package-lifecycle-runtime.js', import.meta.url), 'utf8');
  const portalSource = readFileSync(new URL('../worker/block6-rpc-runtime.js', import.meta.url), 'utf8');
  assert.match(packageSource, /owner_id\s*=\s*\?/i);
  assert.doesNotMatch(packageSource, /SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?'\)\.bind\(table\)\.all\(\)/i);
  assert.match(portalSource, /owner_id\s*=\s*\?/i);
  assert.doesNotMatch(portalSource, /prepare\('SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?'\)/i);
});

test('C12 runtime schemas index the chronological fields used by large clinical lists', () => {
  for (const path of ['../cloudflare/runtime-schema.sql', '../cloudflare/full-migration-schema.sql']) {
    const sql = readFileSync(new URL(path, import.meta.url), 'utf8');
    for (const name of [
      'supabase_records_owner_occurred_at_idx',
      'supabase_records_owner_starts_at_idx',
      'supabase_records_owner_measured_at_idx',
      'supabase_records_owner_created_at_idx',
    ]) assert.match(sql, new RegExp(name, 'i'), `${path} missing ${name}`);
  }
});
