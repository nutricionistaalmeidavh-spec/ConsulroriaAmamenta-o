import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';

const billingSource = readFileSync(new URL('../public/billing-v2.js', import.meta.url), 'utf8');
const domainSource = readFileSync(new URL('../worker/domain-entry.js', import.meta.url), 'utf8');

async function seed(db, table, id, record, ownerId = userId) {
  const now = new Date().toISOString();
  const row = { id, owner_id: ownerId, ...record };
  await db.prepare(`INSERT INTO supabase_records(
    table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
  ) VALUES(?,?,?,?,?,?,?)`).bind(table, id, ownerId, JSON.stringify(row), now, now, now).run();
  return row;
}

async function setup() {
  const runtime = await createLocalRuntime();
  const session = await runtime.login(credentials.email);
  return {
    runtime,
    headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
  };
}

async function rpc(runtime, headers, name, body) {
  return runtime.mf.dispatchFetch(`http://localhost/api/clinical/rpc/${name}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function rows(db, table) {
  const result = await db.prepare('SELECT record_key,record_json FROM supabase_records WHERE table_name=?').bind(table).all();
  return (result.results || []).map((entry) => ({ key: entry.record_key, ...JSON.parse(entry.record_json) }));
}

async function row(db, table, id) {
  const hit = await db.prepare('SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1').bind(table, id).first();
  return hit ? JSON.parse(hit.record_json) : null;
}

test('domain entry exposes one canonical package facade before the generic clinical runtime', () => {
  const facade = domainSource.indexOf('handleAtomicPackageSessionRuntime(request, env, url)');
  const generic = domainSource.indexOf('handleCloudflareClinicalRuntime(request, env)');
  assert.ok(facade >= 0 && generic >= 0 && facade < generic);
});

test('frontend ignores exhausted packages even when their persisted status is still active', () => {
  const match = billingSource.match(/function bvUsablePackages\(packages\)\{[^\n]+\}/);
  assert.ok(match, 'bvUsablePackages must be a pure lifecycle filter');
  const usable = Function(`${match[0]};return bvUsablePackages;`)()([
    { id: 'stale', status: 'active', sessions_total: 4, sessions_used: 4 },
    { id: 'open', status: 'active', sessions_total: 4, sessions_used: 2 },
    { id: 'done', status: 'completed', sessions_total: 4, sessions_used: 4 },
  ]);
  assert.deepEqual(usable.map((item) => item.id), ['open']);
  assert.match(billingSource, /status=neq\.cancelled/);
  assert.match(billingSource, /return bvUsablePackages\(rows\)/);
});

test('creating a new package heals a stale exhausted active package and keeps one usable active package', async (t) => {
  const { runtime, headers } = await setup();
  t.after(() => runtime.close());
  await seed(runtime.db, 'mothers', 'mother-1', { name: 'Mãe 1' });
  await seed(runtime.db, 'appointments', 'appt-1', { mother_id: 'mother-1', status: 'Em atendimento' });
  await seed(runtime.db, 'care_packages', 'old-package', {
    mother_id: 'mother-1', service_label: 'Plano antigo', total_cents: 76000,
    sessions_total: 4, sessions_used: 4, status: 'active',
  });

  const response = await rpc(runtime, headers, 'set_appointment_billing', {
    p_appointment_id: 'appt-1', p_billing_mode: 'package_new', p_service_label: 'Novo acompanhamento',
    p_value_cents: 90000, p_payment_method: 'Pix', p_package_total_cents: 90000,
    p_package_sessions_total: 5, p_package_id: null, p_request_key: 'package-new:appt-1',
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const packages = await rows(runtime.db, 'care_packages');
  const old = packages.find((item) => item.id === 'old-package');
  const fresh = packages.find((item) => item.id === payload.package_id);
  assert.equal(old.status, 'completed');
  assert.ok(fresh);
  assert.equal(fresh.status, 'active');
  assert.equal(fresh.sessions_total, 5);
  assert.equal(fresh.sessions_used, 0);
  assert.equal(packages.filter((item) => item.status === 'active' && Number(item.sessions_used) < Number(item.sessions_total)).length, 1);
  assert.equal((await row(runtime.db, 'appointments', 'appt-1')).package_id, fresh.id);
});

test('manual package consumption through the public worker is idempotent', async (t) => {
  const { runtime, headers } = await setup();
  t.after(() => runtime.close());
  await seed(runtime.db, 'care_packages', 'package-1', {
    mother_id: 'mother-1', service_label: 'Plano', total_cents: 76000,
    sessions_total: 2, sessions_used: 1, status: 'active',
  });
  const body = { p_package_id: 'package-1', p_notes: 'Baixa manual de teste', p_request_key: 'req-1' };
  const first = await rpc(runtime, headers, 'consume_care_package_session_manual', body);
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.idempotent, false);
  assert.equal(firstPayload.sessions_used, 2);
  assert.equal(firstPayload.sessions_remaining, 0);
  assert.equal(firstPayload.package_status, 'completed');

  const second = await rpc(runtime, headers, 'consume_care_package_session_manual', body);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal((await row(runtime.db, 'care_packages', 'package-1')).sessions_used, 2);
  assert.equal((await rows(runtime.db, 'care_package_sessions')).filter((item) => item.package_id === 'package-1').length, 1);
});

test('add_care_package_item_v2 is idempotent and updates financial total once through the public worker', async (t) => {
  const { runtime, headers } = await setup();
  t.after(() => runtime.close());
  await seed(runtime.db, 'care_packages', 'package-v2', {
    mother_id: 'mother-1', service_label: 'Plano', total_cents: 76000,
    sessions_total: 4, sessions_used: 0, status: 'active',
  });
  const body = {
    p_package_id: 'package-v2', p_catalog_item_id: null, p_item_type: 'service',
    p_label: 'Visita adicional', p_quantity_total: 2, p_pricing_mode: 'additional',
    p_unit_price_cents: 5000, p_amount_cents: 10000,
    p_request_key: '11111111-1111-4111-8111-111111111111',
  };
  const first = await rpc(runtime, headers, 'add_care_package_item_v2', body);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).idempotent, false);
  const second = await rpc(runtime, headers, 'add_care_package_item_v2', body);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal((await rows(runtime.db, 'care_package_items')).length, 1);
  assert.equal((await row(runtime.db, 'care_packages', 'package-v2')).total_cents, 86000);
  assert.equal((await rows(runtime.db, 'financial_entries')).length, 1);
});

test('consume_care_package_item_v2 consumes once and preserves request-key idempotency through the public worker', async (t) => {
  const { runtime, headers } = await setup();
  t.after(() => runtime.close());
  await seed(runtime.db, 'care_packages', 'package-v2', {
    mother_id: 'mother-1', service_label: 'Plano', total_cents: 76000,
    sessions_total: 0, sessions_used: 0, status: 'active',
  });
  await seed(runtime.db, 'care_package_items', 'item-v2', {
    package_id: 'package-v2', mother_id: 'mother-1', label: 'Retorno',
    quantity_total: 2, quantity_used: 0, pricing_mode: 'included', status: 'active',
  });
  const body = {
    p_item_id: 'item-v2', p_appointment_id: null, p_encounter_id: null, p_notes: 'uso',
    p_request_key: '22222222-2222-4222-8222-222222222222',
  };
  const first = await rpc(runtime, headers, 'consume_care_package_item_v2', body);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).idempotent, false);
  const second = await rpc(runtime, headers, 'consume_care_package_item_v2', body);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).idempotent, true);
  assert.equal((await row(runtime.db, 'care_package_items', 'item-v2')).quantity_used, 1);
  assert.equal((await rows(runtime.db, 'care_package_item_usages')).length, 1);
});
