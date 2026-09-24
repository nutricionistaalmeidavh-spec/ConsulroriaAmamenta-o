import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const appDataSource = readFileSync('patch-source/cloudflare-license-authority/core/lib/app-data.js', 'utf8');

async function seed(db, table, id, ownerId, record) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
  return row;
}

async function authHeaders(runtime, email = credentials.email) {
  const session = await runtime.login(email);
  return {
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };
}

async function api(runtime, path, headers, { method = 'POST', body } = {}) {
  return runtime.mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function rows(db, table) {
  const result = await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name=?`).bind(table).all();
  return (result.results || []).map((row) => JSON.parse(row.record_json));
}

async function record(db, table, id) {
  const row = await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1`)
    .bind(table, id).first();
  return row ? JSON.parse(row.record_json) : null;
}

function startPayload(requestKey = 'delivery2-start-1') {
  return {
    p_request_key: requestKey,
    p_mother_id: 'm1',
    p_baby_ids: ['b1', 'b2'],
    p_starts_at: '2026-09-24T12:00:00.000Z',
    p_duration_min: 60,
    p_appointment_type: 'Atendimento',
    p_format: 'Domiciliar',
    p_value_cents: 15000,
    p_notes: 'Atendimento conjunto',
  };
}

async function seedFamily(runtime) {
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'babies', 'b1', userId, { mother_id: 'm1', name: 'Bebê 1', current_weight_g: 3900 });
  await seed(runtime.db, 'babies', 'b2', userId, { mother_id: 'm1', name: 'Bebê 2', current_weight_g: 4100 });
}

test('R05 start_clinical_encounter rolls back appointment, encounter and all baby links together', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedFamily(runtime);
  await runtime.db.prepare(`CREATE TRIGGER delivery2_fail_second_encounter_baby
    BEFORE INSERT ON supabase_records
    WHEN NEW.table_name='clinical_encounter_babies'
      AND json_extract(NEW.record_json,'$.baby_id')='b2'
    BEGIN SELECT RAISE(ABORT,'forced_second_baby_link_failure'); END`).run();

  const response = await api(runtime, '/api/clinical/rpc/start_clinical_encounter', headers, {
    body: startPayload('rollback-start'),
  });
  assert.ok(response.status >= 400, `forced aggregate failure must not return ${response.status}`);
  assert.equal((await rows(runtime.db, 'appointments')).length, 0);
  assert.equal((await rows(runtime.db, 'clinical_encounters')).length, 0);
  assert.equal((await rows(runtime.db, 'appointment_babies')).length, 0);
  assert.equal((await rows(runtime.db, 'clinical_encounter_babies')).length, 0);
});

test('R05 retry after a lost start response replays the same appointment and encounter', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedFamily(runtime);
  const payload = startPayload('lost-response-start');

  const first = await api(runtime, '/api/clinical/rpc/start_clinical_encounter', headers, { body: payload });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  const replay = await api(runtime, '/api/clinical/rpc/start_clinical_encounter', headers, { body: payload });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();

  assert.equal(replayBody.appointment_id, firstBody.appointment_id);
  assert.equal(replayBody.encounter_id, firstBody.encounter_id);
  assert.equal((await rows(runtime.db, 'appointments')).length, 1);
  assert.equal((await rows(runtime.db, 'clinical_encounters')).length, 1);
  assert.equal((await rows(runtime.db, 'appointment_babies')).length, 2);
  assert.equal((await rows(runtime.db, 'clinical_encounter_babies')).length, 2);
});

test('R06 concurrent start from one appointment returns one stable encounter and one set of links', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedFamily(runtime);
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', baby_id: null, starts_at: '2026-09-24T12:00:00.000Z', status: 'Agendado',
  });
  await seed(runtime.db, 'appointment_babies', 'a1|b1', userId, { appointment_id: 'a1', baby_id: 'b1', is_primary: true });
  await seed(runtime.db, 'appointment_babies', 'a1|b2', userId, { appointment_id: 'a1', baby_id: 'b2', is_primary: false });

  const responses = await Promise.all(Array.from({ length: 6 }, () => api(
    runtime,
    '/api/clinical/rpc/start_clinical_encounter_from_appointment',
    headers,
    { body: { p_appointment_id: 'a1' } },
  )));
  const payloads = await Promise.all(responses.map(async (response) => {
    assert.equal(response.status, 200);
    return response.json();
  }));
  assert.equal(new Set(payloads.map((item) => item.encounter_id)).size, 1);
  const encounters = (await rows(runtime.db, 'clinical_encounters')).filter((item) => item.appointment_id === 'a1');
  const links = (await rows(runtime.db, 'clinical_encounter_babies')).filter((item) => item.encounter_id === payloads[0].encounter_id);
  assert.equal(encounters.length, 1);
  assert.equal(links.length, 2);
});

test('R07 repeating start for a finalized encounter returns its identity without reopening the appointment', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedFamily(runtime);
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', baby_id: 'b1', starts_at: '2026-09-24T12:00:00.000Z', status: 'Realizado',
  });
  await seed(runtime.db, 'clinical_encounters', 'e1', userId, {
    mother_id: 'm1', baby_id: 'b1', appointment_id: 'a1', status: 'finalized',
  });

  const response = await api(runtime, '/api/clinical/rpc/start_clinical_encounter_from_appointment', headers, {
    body: { p_appointment_id: 'a1' },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.encounter_id, 'e1');
  assert.equal((await record(runtime.db, 'appointments', 'a1')).status, 'Realizado');
  assert.equal((await record(runtime.db, 'clinical_encounters', 'e1')).status, 'finalized');
});

function finalizePayload(requestKey = 'delivery2-finalize-1') {
  return {
    p_request_key: requestKey,
    p_appointment_id: 'a1',
    p_encounter_id: 'e1',
    p_appointment_patch: {
      starts_at: '2026-09-24T12:00:00.000Z', duration_min: 60,
      appointment_type: 'Atendimento', format: 'Domiciliar', status: 'Realizado',
      value_cents: 15000, payment_status: 'Pendente', notes: '',
    },
    p_encounter_patch: {
      status: 'finalized', occurred_at: '2026-09-24T12:00:00.000Z',
      clinical_state: { identification: { appointmentType: 'Atendimento' } },
    },
    p_weights: [{ baby_id: 'b1', weight_g: 4200, measured_at: '2026-09-24T12:00:00.000Z' }],
    p_followup: { baby_id: 'b1', due_at: '2026-10-01T12:00:00.000Z', notes: 'Retorno' },
    p_financial: { description: 'Atendimento', amount_cents: 15000, due_at: '2026-09-24' },
  };
}

async function seedDraftEncounter(runtime) {
  await seedFamily(runtime);
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', baby_id: 'b1', starts_at: '2026-09-24T12:00:00.000Z', status: 'Em atendimento',
    billing_mode: 'individual', value_cents: 15000,
  });
  await seed(runtime.db, 'clinical_encounters', 'e1', userId, {
    mother_id: 'm1', baby_id: 'b1', appointment_id: 'a1', status: 'draft',
  });
}

test('R08 finalization commits appointment, encounter, weight, baby, followup and billing once and replays safely', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedDraftEncounter(runtime);
  const payload = finalizePayload('finalize-retry');

  const first = await api(runtime, '/api/clinical/rpc/finalize_clinical_encounter_atomic', headers, { body: payload });
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.encounter_id, 'e1');
  const replay = await api(runtime, '/api/clinical/rpc/finalize_clinical_encounter_atomic', headers, { body: payload });
  assert.equal(replay.status, 200);
  const replayBody = await replay.json();
  assert.equal(replayBody.idempotent, true);

  assert.equal((await record(runtime.db, 'appointments', 'a1')).status, 'Realizado');
  assert.equal((await record(runtime.db, 'clinical_encounters', 'e1')).status, 'finalized');
  assert.equal((await record(runtime.db, 'babies', 'b1')).current_weight_g, 4200);
  assert.equal((await rows(runtime.db, 'weights')).filter((item) => item.encounter_id === 'e1').length, 1);
  assert.equal((await rows(runtime.db, 'followups')).filter((item) => item.encounter_id === 'e1').length, 1);
  assert.equal((await rows(runtime.db, 'financial_entries')).filter((item) => item.encounter_id === 'e1').length, 1);
});

test('R08 a late billing failure rolls back every finalization side effect', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedDraftEncounter(runtime);
  await runtime.db.prepare(`CREATE TRIGGER delivery2_fail_financial
    BEFORE INSERT ON supabase_records
    WHEN NEW.table_name='financial_entries'
    BEGIN SELECT RAISE(ABORT,'forced_financial_failure'); END`).run();

  const response = await api(runtime, '/api/clinical/rpc/finalize_clinical_encounter_atomic', headers, {
    body: finalizePayload('finalize-rollback'),
  });
  assert.ok(response.status >= 400, `forced aggregate failure must not return ${response.status}`);
  assert.equal((await record(runtime.db, 'appointments', 'a1')).status, 'Em atendimento');
  assert.equal((await record(runtime.db, 'clinical_encounters', 'e1')).status, 'draft');
  assert.equal((await record(runtime.db, 'babies', 'b1')).current_weight_g, 3900);
  assert.equal((await rows(runtime.db, 'weights')).length, 0);
  assert.equal((await rows(runtime.db, 'followups')).length, 0);
  assert.equal((await rows(runtime.db, 'financial_entries')).length, 0);
});

test('C01 finalized encounters reject generic PATCH attempts that regress them to draft', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedDraftEncounter(runtime);
  const finalized = { ...(await record(runtime.db, 'clinical_encounters', 'e1')), status: 'finalized' };
  const now = new Date().toISOString();
  await runtime.db.prepare(`UPDATE supabase_records SET record_json=?,source_updated_at=?,migrated_at=?
    WHERE table_name='clinical_encounters' AND record_key='e1'`).bind(JSON.stringify(finalized), now, now).run();

  const response = await api(runtime, '/api/clinical/records/clinical_encounters?id=eq.e1', headers, {
    method: 'PATCH', body: { status: 'draft', clinical_note: 'late autosave' },
  });
  assert.equal(response.status, 409);
  assert.equal((await record(runtime.db, 'clinical_encounters', 'e1')).status, 'finalized');
});

test('C01 app-data serializes encounter writes and closes the draft queue before atomic finalization', () => {
  assert.match(appDataSource, /const encounterWriteChains = new Map\(\)/);
  assert.match(appDataSource, /const encounterLifecycle = new Map\(\)/);
  assert.match(appDataSource, /function queueEncounterWrite/);
  assert.match(appDataSource, /encounterLifecycle\.set\(id, 'finalizing'\)/);
  assert.match(appDataSource, /lifecycle === 'finalizing' \|\| lifecycle === 'finalized'/);
  assert.match(appDataSource, /finalize_clinical_encounter_atomic/);
  assert.match(appDataSource, /pendingAppointmentFinalization/);
});
