import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';
import {
  hardenDelivery1AppShell,
  hardenDelivery1PatientFixes,
} from '../scripts/harden-delivery1-integrity.mjs';

const appShellSource = hardenDelivery1AppShell(readFileSync('public/clinical-source/core/app-shell.js', 'utf8'));
const patientFixesSource = hardenDelivery1PatientFixes(readFileSync('public/clinical-source/features/patient-fixes.js', 'utf8'));

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

async function api(runtime, path, headers, { method = 'GET', body } = {}) {
  return runtime.mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test('R01 openPatient invalidates stale asynchronous patient projections before render or navigation', () => {
  assert.match(appShellSource, /patientOpenRevision/,
    'openPatient needs a monotonic navigation revision');
  assert.match(appShellSource, /const\s+openRevision\s*=\s*\+\+patientOpenRevision/,
    'each openPatient call must claim a new revision');
  assert.match(appShellSource, /openRevision\s*!==\s*patientOpenRevision/,
    'stale responses must be rejected before applying async results');
  assert.match(appShellSource, /currentPatientId\s*!==\s*patient\.mother\.id/,
    'patient identity must still match before async UI is applied');
  assert.match(appShellSource, /currentBabyId\s*!==\s*\(selectedBaby\?\.id\s*\|\|\s*null\)/,
    'baby identity must still match before async UI is applied');
  assert.match(appShellSource, /if\s*\(screen\s*!==\s*'patient'\)\s*patientOpenRevision\s*\+=\s*1/,
    'navigating away from the patient screen must invalidate pending patient reads');
});

test('R19 patient action bindings are refreshed by patient identity and ignore stale context on lookup and click', () => {
  assert.match(patientFixesSource, /if\(pfPatientId\(\)!==mid\)return;/,
    'a delayed patient lookup must not bind actions after navigation changed');
  assert.match(patientFixesSource, /b\.dataset\.pfBound===mid/,
    'the same DOM node may only skip rebinding for the same patient');
  assert.match(patientFixesSource, /if\(pfPatientId\(\)!==mid\)\{pfSchedule\(\);return\}/,
    'patient-targeted actions must verify the active patient again at click time');
  assert.doesNotMatch(patientFixesSource, /if\(!t\|\|b\.dataset\.pfBound\)continue;/,
    'a permanent boolean bound marker preserves the previous patient target');
});

test('R02 PATCH validates the persisted mother together with a changed baby_id', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'mothers', 'm2', userId, { name: 'Mãe 2' });
  await seed(runtime.db, 'babies', 'b1', userId, { mother_id: 'm1', name: 'Bebê 1' });
  await seed(runtime.db, 'babies', 'b2', userId, { mother_id: 'm2', name: 'Bebê 2' });
  await seed(runtime.db, 'appointments', 'a1', userId, { mother_id: 'm1', baby_id: 'b1', status: 'Agendado' });

  const response = await api(runtime, '/api/clinical/records/appointments?id=eq.a1', headers, {
    method: 'PATCH', body: { baby_id: 'b2' },
  });
  assert.equal(response.status, 409);
  const persisted = await runtime.db.prepare(`SELECT record_json FROM supabase_records
    WHERE table_name='appointments' AND record_key='a1'`).first();
  assert.equal(JSON.parse(persisted.record_json).baby_id, 'b1', 'rejected PATCH must not mutate the record');
});

test('R02 PATCH validates the persisted baby together with a changed mother_id', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'mothers', 'm2', userId, { name: 'Mãe 2' });
  await seed(runtime.db, 'babies', 'b1', userId, { mother_id: 'm1', name: 'Bebê 1' });
  await seed(runtime.db, 'appointments', 'a1', userId, { mother_id: 'm1', baby_id: 'b1', status: 'Agendado' });

  const response = await api(runtime, '/api/clinical/records/appointments?id=eq.a1', headers, {
    method: 'PATCH', body: { mother_id: 'm2' },
  });
  assert.equal(response.status, 409);
});

test('R02 PATCH rejects an encounter_id incompatible with the persisted appointment_id', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'appointments', 'a1', userId, { mother_id: 'm1', status: 'Em atendimento' });
  await seed(runtime.db, 'appointments', 'a2', userId, { mother_id: 'm1', status: 'Em atendimento' });
  await seed(runtime.db, 'clinical_encounters', 'e1', userId, { mother_id: 'm1', appointment_id: 'a1', status: 'draft' });
  await seed(runtime.db, 'clinical_encounters', 'e2', userId, { mother_id: 'm1', appointment_id: 'a2', status: 'draft' });
  await seed(runtime.db, 'financial_entries', 'f1', userId, {
    mother_id: 'm1', appointment_id: 'a1', encounter_id: 'e1', amount_cents: 10000, status: 'Pendente',
  });

  const response = await api(runtime, '/api/clinical/records/financial_entries?id=eq.f1', headers, {
    method: 'PATCH', body: { encounter_id: 'e2' },
  });
  assert.equal(response.status, 409);
});

test('R03 schedule_clinical_appointment rejects a mother owned by another account', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'foreign-mother', 'audit-other', { name: 'Outra conta' });

  const response = await api(runtime, '/api/clinical/rpc/schedule_clinical_appointment', headers, {
    method: 'POST',
    body: { p_mother_id: 'foreign-mother', p_baby_ids: [], p_starts_at: '2026-09-24T12:00:00.000Z' },
  });
  assert.equal(response.status, 403);
});

test('R03 schedule_clinical_appointment rejects mother and baby from different families', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'mothers', 'm2', userId, { name: 'Mãe 2' });
  await seed(runtime.db, 'babies', 'b2', userId, { mother_id: 'm2', name: 'Bebê 2' });

  const response = await api(runtime, '/api/clinical/rpc/schedule_clinical_appointment', headers, {
    method: 'POST',
    body: { p_mother_id: 'm1', p_baby_ids: ['b2'], p_starts_at: '2026-09-24T12:00:00.000Z' },
  });
  assert.equal(response.status, 409);
});

test('R03 schedule_clinical_appointment rejects an unknown baby reference', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });

  const response = await api(runtime, '/api/clinical/rpc/schedule_clinical_appointment', headers, {
    method: 'POST',
    body: { p_mother_id: 'm1', p_baby_ids: ['missing-baby'], p_starts_at: '2026-09-24T12:00:00.000Z' },
  });
  assert.equal(response.status, 403);
});

test('R04 finalize_encounter_billing rejects an encounter from another appointment of the same mother', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'care_packages', 'pkg1', userId, {
    mother_id: 'm1', status: 'active', sessions_total: 3, sessions_used: 0, total_cents: 30000,
  });
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', status: 'Em atendimento', billing_mode: 'package_active', package_id: 'pkg1',
  });
  await seed(runtime.db, 'appointments', 'a2', userId, {
    mother_id: 'm1', status: 'Em atendimento', billing_mode: 'individual',
  });
  await seed(runtime.db, 'clinical_encounters', 'e2', userId, {
    mother_id: 'm1', appointment_id: 'a2', status: 'draft',
  });

  const response = await api(runtime, '/api/clinical/rpc/finalize_encounter_billing', headers, {
    method: 'POST', body: { p_appointment_id: 'a1', p_encounter_id: 'e2' },
  });
  assert.equal(response.status, 409);
  const pkg = await runtime.db.prepare(`SELECT record_json FROM supabase_records
    WHERE table_name='care_packages' AND record_key='pkg1'`).first();
  assert.equal(JSON.parse(pkg.record_json).sessions_used, 0, 'invalid linkage must not consume a package session');
});

test('R04 package finalization requires encounter_id so retries use one stable identity', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'm1', userId, { name: 'Mãe 1' });
  await seed(runtime.db, 'care_packages', 'pkg1', userId, {
    mother_id: 'm1', status: 'active', sessions_total: 3, sessions_used: 0, total_cents: 30000,
  });
  await seed(runtime.db, 'appointments', 'a1', userId, {
    mother_id: 'm1', status: 'Em atendimento', billing_mode: 'package_active', package_id: 'pkg1',
  });

  const response = await api(runtime, '/api/clinical/rpc/finalize_encounter_billing', headers, {
    method: 'POST', body: { p_appointment_id: 'a1' },
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.field, 'encounter_id');
  const pkg = await runtime.db.prepare(`SELECT record_json FROM supabase_records
    WHERE table_name='care_packages' AND record_key='pkg1'`).first();
  assert.equal(JSON.parse(pkg.record_json).sessions_used, 0, 'missing encounter identity must not consume a package session');
});
