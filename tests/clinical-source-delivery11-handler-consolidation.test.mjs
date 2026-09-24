import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const domainSource = readFileSync('worker/domain-entry.js', 'utf8');
const facadeSource = readFileSync('worker/package-session-atomic-runtime.js', 'utf8');
const integritySource = readFileSync('worker/package-integrity-atomic-runtime.js', 'utf8');

function occurrences(source, token) {
  return source.split(token).length - 1;
}

async function seed(db, table, id, record, ownerId = userId) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
  return row;
}

async function authHeaders(runtime) {
  const session = await runtime.login(credentials.email);
  return { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' };
}

test('T10 package RPCs have one public handler facade in domain-entry', () => {
  assert.equal(occurrences(domainSource, "from './package-session-atomic-runtime.js'"), 1);
  assert.equal(occurrences(domainSource, 'handleAtomicPackageSessionRuntime(request, env, url)'), 1);
  assert.doesNotMatch(domainSource, /encounter-billing-atomic-runtime\.js/);
  assert.doesNotMatch(domainSource, /package-lifecycle-runtime\.js/);
  assert.doesNotMatch(domainSource, /handleAtomicEncounterFinalizeRuntime/);
  assert.doesNotMatch(domainSource, /handlePackageLifecycleRuntime/);
});

test('T10 canonical package facade delegates integrity RPCs and owns manual/finalize session RPCs', () => {
  assert.match(facadeSource, /handleAtomicPackageIntegrityRuntime/);
  assert.match(facadeSource, /consume_care_package_session_manual/);
  assert.match(facadeSource, /finalize_encounter_billing/);
  assert.match(integritySource, /set_appointment_billing/);
  assert.match(integritySource, /add_care_package_item_v2/);
  assert.match(integritySource, /consume_care_package_item_v2/);
});

test('T10 inactive duplicate package handlers are removed after regression coverage', () => {
  assert.equal(existsSync('worker/encounter-billing-atomic-runtime.js'), false);
  assert.equal(existsSync('worker/package-lifecycle-runtime.js'), false);
});

test('T10 public worker entry still routes package creation through the canonical facade', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seed(runtime.db, 'mothers', 'mother-d11', { name: 'Mãe D11' });
  await seed(runtime.db, 'appointments', 'appointment-d11', {
    mother_id: 'mother-d11', status: 'Em atendimento', appointment_type: 'Acompanhamento',
    starts_at: '2026-09-23T15:00:00.000Z',
  });

  const response = await runtime.mf.dispatchFetch('http://localhost/api/clinical/rpc/set_appointment_billing', {
    method: 'POST', headers, body: JSON.stringify({
      p_appointment_id: 'appointment-d11', p_billing_mode: 'package_new',
      p_service_label: 'Plano D11', p_value_cents: 76000, p_payment_method: 'Pix',
      p_package_total_cents: 76000, p_package_sessions_total: 4,
      p_package_id: null, p_request_key: 'package-new:appointment-d11',
    }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.package_id);

  const packages = await runtime.db.prepare(`SELECT COUNT(*) AS n FROM supabase_records
    WHERE table_name='care_packages' AND owner_id=?`).bind(userId).first();
  const charges = await runtime.db.prepare(`SELECT COUNT(*) AS n FROM supabase_records
    WHERE table_name='financial_entries' AND owner_id=?`).bind(userId).first();
  assert.equal(Number(packages?.n || 0), 1);
  assert.equal(Number(charges?.n || 0), 1);
});
