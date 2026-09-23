import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const noteSource = readFileSync('public/clinical-source/features/clinical-note-feature.js', 'utf8');
const appDataSource = readFileSync('patch-source/cloudflare-license-authority/core/lib/app-data.js', 'utf8');

async function seed(db, table, id, ownerId, record) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
  return row;
}

async function authHeaders(runtime) {
  const session = await runtime.login(credentials.email);
  return {
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };
}

async function api(runtime, path, headers, { method = 'PATCH', body } = {}) {
  return runtime.mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function record(db, table, id) {
  const row = await db.prepare(`SELECT record_json FROM supabase_records
    WHERE table_name=? AND record_key=? LIMIT 1`).bind(table, id).first();
  return row ? JSON.parse(row.record_json) : null;
}

async function rows(db, table) {
  const result = await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name=?`).bind(table).all();
  return (result.results || []).map((row) => JSON.parse(row.record_json));
}

async function seedEncounter(runtime, overrides = {}) {
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'appointments', 'a1', userId, { mother_id: 'm1', status: 'Em atendimento' });
  await seed(runtime.db, 'clinical_encounters', 'e1', userId, {
    mother_id: 'm1', appointment_id: 'a1', status: 'draft', clinical_note: 'base', record_version: 1,
    ...overrides,
  });
}

test('R09/C10 stale autosave PATCH is rejected and cannot overwrite the newer clinical note', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedEncounter(runtime);

  const first = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    body: { _expected_version: 1, clinical_note: 'texto mais novo' },
  });
  assert.equal(first.status, 200);
  const firstRows = await first.json();
  assert.equal(firstRows[0].record_version, 2);

  const stale = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    body: { _expected_version: 1, clinical_note: 'autosave atrasado' },
  });
  assert.equal(stale.status, 409);
  const staleBody = await stale.json();
  assert.equal(staleBody.error, 'stale_record_version');
  assert.equal(staleBody.current_version, 2);

  const persisted = await record(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(persisted.clinical_note, 'texto mais novo');
  assert.equal(persisted.record_version, 2);
});

test('R10 finalized note edit writes the previous note revision in the same atomic mutation', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedEncounter(runtime, { status: 'finalized', clinical_note: 'versão anterior' });

  const response = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    body: { _expected_version: 1, clinical_note: 'versão corrigida' },
  });
  assert.equal(response.status, 200);
  const persisted = await record(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(persisted.clinical_note, 'versão corrigida');
  assert.equal(persisted.record_version, 2);

  const revisions = (await rows(runtime.db, 'clinical_note_revisions')).filter((row) => row.encounter_id === 'e1');
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].previous_clinical_note, 'versão anterior');
  assert.equal(revisions[0].previous_version, 1);
  assert.equal(revisions[0].resulting_version, 2);
});

test('R10 revision failure rolls back the finalized note edit instead of leaving an unaudited change', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedEncounter(runtime, { status: 'finalized', clinical_note: 'versão auditada' });
  await runtime.db.prepare(`CREATE TRIGGER delivery3_fail_revision
    BEFORE INSERT ON supabase_records
    WHEN NEW.table_name='clinical_note_revisions'
    BEGIN SELECT RAISE(ABORT,'forced_revision_failure'); END`).run();

  const response = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    body: { _expected_version: 1, clinical_note: 'mudança sem revisão' },
  });
  assert.ok(response.status >= 400, `forced revision failure must not return ${response.status}`);
  const persisted = await record(runtime.db, 'clinical_encounters', 'e1');
  assert.equal(persisted.clinical_note, 'versão auditada');
  assert.equal(persisted.record_version, 1);
  assert.equal((await rows(runtime.db, 'clinical_note_revisions')).length, 0);
});

test('R11 finalized clinical encounters are retained and cannot be removed through generic DELETE', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedEncounter(runtime, { status: 'finalized' });

  const response = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    method: 'DELETE', body: undefined,
  });
  assert.equal(response.status, 409);
  assert.equal((await record(runtime.db, 'clinical_encounters', 'e1')).status, 'finalized');
});

test('R11 clinical note revisions are immutable through the generic records API', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedEncounter(runtime, { status: 'finalized' });
  await seed(runtime.db, 'clinical_note_revisions', 'r1', userId, {
    encounter_id: 'e1', previous_clinical_note: 'antiga', previous_version: 1, resulting_version: 2,
  });

  const response = await api(runtime, '/api/clinical/records/clinical_note_revisions?id=eq.r1', headers, {
    method: 'DELETE', body: undefined,
  });
  assert.equal(response.status, 405);
  assert.ok(await record(runtime.db, 'clinical_note_revisions', 'r1'));
});

test('R09 clinical note autosave tracks edit revisions, serializes writes and sends the expected record version', () => {
  assert.match(noteSource, /editRevision/);
  assert.match(noteSource, /persistedRevision/);
  assert.match(noteSource, /saveChain/);
  assert.match(noteSource, /pendingBody/);
  assert.match(noteSource, /cnDrainSaves/);
  assert.match(noteSource, /_expected_version/);
  assert.match(noteSource, /record_version/);
  assert.doesNotMatch(noteSource, /if\(cnState\.saving&&!force\)return enc/,
    'an in-flight save must not silently discard a newer edit');
});

test('R09 wizard encounter autosave participates in optimistic record versioning', () => {
  assert.match(appDataSource, /encounterVersions/);
  assert.match(appDataSource, /_expected_version/);
  assert.match(appDataSource, /record_version/);
});
