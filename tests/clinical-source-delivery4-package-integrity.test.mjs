import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalRuntime, credentials, userId } from './helpers/cloudflare-local.mjs';
import { transformDelivery4Billing } from '../scripts/harden-delivery4-package-billing.mjs';

const billingSource = readFileSync('public/billing-v2.js', 'utf8');
const hardenedBillingSource = transformDelivery4Billing(billingSource);
const packageSource = readFileSync('worker/package-integrity-atomic-runtime.js', 'utf8');
const sessionSource = readFileSync('worker/package-session-atomic-runtime.js', 'utf8');
const packageJson = readFileSync('package.json', 'utf8');

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
  return {
    authorization: `Bearer ${session.access_token}`,
    'content-type': 'application/json',
  };
}

async function rpc(runtime, headers, name, body) {
  return runtime.mf.dispatchFetch(`http://localhost/api/clinical/rpc/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function rows(db, table) {
  const result = await db.prepare(`SELECT record_key,record_json FROM supabase_records WHERE table_name=?`).bind(table).all();
  return (result.results || []).map((row) => ({ key: row.record_key, ...JSON.parse(row.record_json) }));
}

async function row(db, table, id) {
  const hit = await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name=? AND record_key=? LIMIT 1`).bind(table, id).first();
  return hit ? JSON.parse(hit.record_json) : null;
}

async function seedPackageAppointment(runtime, { appointmentId = 'appointment-1', packageId = null, total = 76000, sessions = 4 } = {}) {
  await seed(runtime.db, 'mothers', 'mother-1', { name: 'Mãe 1' });
  await seed(runtime.db, 'appointments', appointmentId, {
    mother_id: 'mother-1', status: 'Em atendimento', appointment_type: 'Acompanhamento', starts_at: '2026-09-23T15:00:00.000Z',
    ...(packageId ? { billing_mode: 'package_active', package_id: packageId } : {}),
  });
  if (packageId) {
    await seed(runtime.db, 'care_packages', packageId, {
      mother_id: 'mother-1', service_label: 'Plano', total_cents: total,
      sessions_total: sessions, sessions_used: 0, status: 'active', payment_method: 'Pix',
    });
  }
}

function newPackageBody(appointmentId = 'appointment-1') {
  return {
    p_appointment_id: appointmentId,
    p_billing_mode: 'package_new',
    p_service_label: 'Acompanhamento',
    p_value_cents: 76000,
    p_payment_method: 'Pix',
    p_package_total_cents: 76000,
    p_package_sessions_total: 4,
    p_package_id: null,
    p_request_key: `package-new:${appointmentId}`,
  };
}

test('R12 package_new replay after a lost response returns the same package instead of self-blocking', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedPackageAppointment(runtime);
  const body = newPackageBody();

  const first = await rpc(runtime, headers, 'set_appointment_billing', body);
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.ok(firstPayload.package_id);

  const retry = await rpc(runtime, headers, 'set_appointment_billing', body);
  assert.equal(retry.status, 200);
  const retryPayload = await retry.json();
  assert.equal(retryPayload.package_id, firstPayload.package_id);

  const packages = await rows(runtime.db, 'care_packages');
  assert.equal(packages.length, 1);
  assert.equal(packages[0].id, firstPayload.package_id);
  const appointment = await row(runtime.db, 'appointments', 'appointment-1');
  assert.equal(appointment.package_id, firstPayload.package_id);
});

test('R13 package_new creates exactly one linked base financial entry with the exact package total', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedPackageAppointment(runtime);
  const body = newPackageBody();

  const first = await rpc(runtime, headers, 'set_appointment_billing', body);
  assert.equal(first.status, 200);
  const appointment = await first.json();
  const packageId = appointment.package_id;
  assert.ok(packageId);

  const pkg = (await rows(runtime.db, 'care_packages')).find((item) => item.id === packageId);
  const financial = (await rows(runtime.db, 'financial_entries')).filter((item) => item.package_id === packageId);
  assert.equal(financial.length, 1, 'package base charge must exist exactly once');
  assert.equal(financial[0].amount_cents, 76000);
  assert.equal(financial[0].status, 'Pendente');
  assert.equal(pkg.financial_entry_id, financial[0].id);

  const retry = await rpc(runtime, headers, 'set_appointment_billing', body);
  assert.equal(retry.status, 200);
  assert.equal((await rows(runtime.db, 'financial_entries')).filter((item) => item.package_id === packageId).length, 1);
});

test('R14 two concurrent usages of a quantity-one package item persist exactly one usage', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedPackageAppointment(runtime, { packageId: 'package-1', sessions: 0 });
  await seed(runtime.db, 'care_package_items', 'item-1', {
    package_id: 'package-1', mother_id: 'mother-1', label: 'Visita adicional',
    quantity_total: 1, quantity_used: 0, pricing_mode: 'included', amount_cents: 0, status: 'active',
  });

  const make = (key) => rpc(runtime, headers, 'consume_care_package_item_v2', {
    p_item_id: 'item-1', p_request_key: key, p_appointment_id: null, p_encounter_id: null, p_notes: '',
  });
  const [a, b] = await Promise.all([make('usage-a'), make('usage-b')]);
  assert.deepEqual([a.status, b.status].sort((x, y) => x - y), [200, 409]);

  const item = await row(runtime.db, 'care_package_items', 'item-1');
  assert.equal(item.quantity_used, 1);
  assert.equal((await rows(runtime.db, 'care_package_item_usages')).filter((usage) => usage.package_item_id === 'item-1').length, 1);
});

test('R15 concurrent retries with the same session key debit the package exactly once', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedPackageAppointment(runtime, { packageId: 'package-1', sessions: 3 });

  const body = { p_package_id: 'package-1', p_notes: 'baixa concorrente', p_request_key: 'same-session-key' };
  const [a, b] = await Promise.all([
    rpc(runtime, headers, 'consume_care_package_session_manual', body),
    rpc(runtime, headers, 'consume_care_package_session_manual', body),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  const pkg = await row(runtime.db, 'care_packages', 'package-1');
  assert.equal(pkg.sessions_used, 1);
  assert.equal((await rows(runtime.db, 'care_package_sessions')).filter((session) => session.package_id === 'package-1').length, 1);
});

test('C09 concurrent additional items add their amounts without overwriting each other or duplicating the base charge', async (t) => {
  const runtime = await createLocalRuntime();
  t.after(() => runtime.close());
  const headers = await authHeaders(runtime);
  await seedPackageAppointment(runtime);
  const created = await rpc(runtime, headers, 'set_appointment_billing', newPackageBody());
  assert.equal(created.status, 200);
  const appointment = await created.json();
  const packageId = appointment.package_id;

  const add = (key, label, amount) => rpc(runtime, headers, 'add_care_package_item_v2', {
    p_package_id: packageId, p_label: label, p_quantity: 1, p_category: 'service',
    p_pricing_mode: 'additional', p_amount_cents: amount, p_notes: '', p_request_key: key,
  });
  const [a, b] = await Promise.all([
    add('additional-a', 'Visita A', 5000),
    add('additional-b', 'Visita B', 7000),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);

  const pkg = (await rows(runtime.db, 'care_packages')).find((item) => item.id === packageId);
  assert.equal(pkg.total_cents, 88000);
  assert.equal((await rows(runtime.db, 'care_package_items')).filter((item) => item.package_id === packageId).length, 2);
  const financial = (await rows(runtime.db, 'financial_entries')).filter((item) => item.package_id === packageId);
  assert.equal(financial.length, 1, 'pending base package charge must remain a single entry');
  assert.equal(financial[0].id, pkg.financial_entry_id);
  assert.equal(financial[0].amount_cents, 88000);
});

test('R12 frontend sends a stable package-new operation key tied to the appointment identity', () => {
  assert.match(hardenedBillingSource, /p_request_key/);
  assert.match(hardenedBillingSource, /package-new:/);
  assert.match(packageJson, /harden-delivery4-package-billing\.mjs --write/);
});

test('R14/R15/C09 package runtimes contain conditional claims instead of stale whole-record package debits', () => {
  assert.match(packageSource, /package_item_claim/);
  assert.match(packageSource, /quantity_used/);
  assert.match(packageSource, /NOT EXISTS/);
  assert.match(sessionSource, /NOT EXISTS/);
  assert.match(sessionSource, /care_package_sessions/);
  assert.match(sessionSource, /handleAtomicPackageIntegrityRuntime/);
});