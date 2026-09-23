import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleBlock6RpcRuntime } from '../worker/block6-rpc-runtime.js';

const demoSource = readFileSync(new URL('../public/demo-feature.js', import.meta.url), 'utf8');
const bootstrapSource = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
const clinicalNoteSource = readFileSync(new URL('../public/clinical-source/features/clinical-note-feature.js', import.meta.url), 'utf8');
const clinicalManifest = JSON.parse(readFileSync(new URL('../public/clinical-source/manifest.json', import.meta.url), 'utf8'));
const packageSource = readFileSync(new URL('../worker/package-lifecycle-runtime.js', import.meta.url), 'utf8');
const billingSource = readFileSync(new URL('../public/billing-v2.js', import.meta.url), 'utf8');
const appDataSource = readFileSync(new URL('../public/clinical-source/core/lib/app-data.js', import.meta.url), 'utf8');

class FakeStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async all() { return this.db.all(this.sql, this.args); }
  async run() { return this.db.run(this.sql, this.args); }
}

class FakeD1 {
  constructor() { this.records = new Map(); }
  prepare(sql) { return new FakeStatement(this, sql); }
  seed(table, key, ownerId, record) {
    this.records.set(`${table}:${key}`, { table, key, ownerId, record: { ...record } });
  }
  table(table) { return [...this.records.values()].filter((row) => row.table === table).map((row) => row.record); }
  async all(sql, args) {
    if (/SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?/i.test(sql)) {
      const table = String(args[0]);
      return { results: [...this.records.values()].filter((row) => row.table === table).map((row) => ({
        record_key: row.key,
        owner_id: row.ownerId,
        record_json: JSON.stringify(row.record),
      })) };
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }
  async run(sql, args) {
    if (/INSERT INTO supabase_records/i.test(sql)) {
      const [table, key, ownerId, recordJson] = args;
      this.records.set(`${table}:${key}`, { table, key, ownerId: ownerId || null, record: JSON.parse(recordJson) });
      return { success: true };
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
}

function request(path, { method = 'POST', body } = {}) {
  return new Request(`https://app.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const member = { id: 'member-user-1', email: 'mae@example.test' };
const authenticate = async () => member;

for (const rpc of ['bootstrap_demo_data', 'delete_appointment', 'delete_clinical_encounter']) {
  test(`${rpc} is explicitly retired and cannot mutate D1`, async () => {
    const db = new FakeD1();
    const req = request(`/rest/v1/rpc/${rpc}`, { body: { p_confirmation: 'EXCLUIR' } });
    const response = await handleBlock6RpcRuntime(req, { CLINICAL_DB: db }, new URL(req.url), { authenticate });
    assert.ok(response, 'Block 6 runtime must close the retired RPC explicitly');
    assert.equal(response.status, 410);
    const payload = await response.json();
    assert.equal(payload.error, 'rpc_retired');
    assert.equal(db.records.size, 0, 'retired RPCs must not mutate clinical data');
  });
}

test('claim_member_portal binds an invited e-mail once and is idempotent', async () => {
  const db = new FakeD1();
  db.seed('member_portal_access', 'access-1', 'professional-1', {
    id: 'access-1', owner_id: 'professional-1', mother_id: 'mother-1', email: member.email,
    member_user_id: null, tier: 'essential', active: true, show_progress: true,
  });
  const req = request('/rest/v1/rpc/claim_member_portal', { body: {} });
  const first = await handleBlock6RpcRuntime(req, { CLINICAL_DB: db }, new URL(req.url), { authenticate });
  assert.equal(first.status, 200);
  const firstPayload = await first.json();
  assert.equal(firstPayload.member_user_id, member.id);
  assert.equal(db.table('member_portal_access')[0].member_user_id, member.id);

  const secondReq = request('/rest/v1/rpc/claim_member_portal', { body: {} });
  const second = await handleBlock6RpcRuntime(secondReq, { CLINICAL_DB: db }, new URL(secondReq.url), { authenticate });
  assert.equal(second.status, 200);
  assert.equal((await second.json()).member_user_id, member.id);
  assert.equal(db.table('member_portal_access').length, 1);
});

test('member portal reads are scoped to the claimed mother and owner', async () => {
  const db = new FakeD1();
  db.seed('member_portal_access', 'access-1', 'professional-1', {
    id: 'access-1', owner_id: 'professional-1', mother_id: 'mother-1', email: member.email,
    member_user_id: member.id, tier: 'essential', active: true, show_progress: true,
  });
  db.seed('member_shared_items', 'shared-1', 'professional-1', {
    id: 'shared-1', owner_id: 'professional-1', mother_id: 'mother-1', title: 'Meu material', published: true,
  });
  db.seed('member_shared_items', 'shared-2', 'professional-1', {
    id: 'shared-2', owner_id: 'professional-1', mother_id: 'mother-2', title: 'Outro material', published: true,
  });
  const req = request('/rest/v1/member_shared_items?select=*&owner_id=eq.professional-1&order=occurred_at.desc', { method: 'GET' });
  const response = await handleBlock6RpcRuntime(req, { CLINICAL_DB: db }, new URL(req.url), { authenticate });
  assert.equal(response.status, 200);
  const rows = await response.json();
  assert.deepEqual(rows.map((row) => row.id), ['shared-1']);
});

test('member engagement writes cannot forge professional or mother ownership', async () => {
  const db = new FakeD1();
  db.seed('member_portal_access', 'access-1', 'professional-1', {
    id: 'access-1', owner_id: 'professional-1', mother_id: 'mother-1', email: member.email,
    member_user_id: member.id, tier: 'essential', active: true, show_progress: true,
  });
  const req = request('/rest/v1/member_engagement_events', { body: {
    owner_id: 'professional-evil', mother_id: 'mother-evil', member_access_id: 'access-evil',
    event_type: 'portal_visit', event_key: '2026-09-22', item_kind: 'portal', item_id: null,
  }});
  const response = await handleBlock6RpcRuntime(req, { CLINICAL_DB: db }, new URL(req.url), { authenticate });
  assert.equal(response.status, 201);
  const [event] = db.table('member_engagement_events');
  assert.equal(event.owner_id, 'professional-1');
  assert.equal(event.mother_id, 'mother-1');
  assert.equal(event.member_access_id, 'access-1');
});

test('legacy consumers for retired Block 6 RPCs are gone', () => {
  assert.doesNotMatch(demoSource, /bootstrap_demo_data/);
  assert.doesNotMatch(bootstrapSource, /demo-feature\.js/);
  assert.doesNotMatch(clinicalNoteSource, /delete_clinical_encounter|data-cn-delete|Excluir atendimento/);
  assert.doesNotMatch(appDataSource, /['"]delete_appointment['"]/);
  assert.match(appDataSource, /delete_scheduled_appointment/);
});

test('materialized clinical note hash stays in sync with the canonical manifest', () => {
  const digest = createHash('sha256').update(clinicalNoteSource).digest('hex');
  assert.equal(clinicalManifest.modules['features/clinical-note-feature.js'].sha256, digest);
});

test('package v2 RPCs are owned by the D1 package lifecycle runtime and accept the live frontend payload', () => {
  assert.match(packageSource, /add_care_package_item_v2/);
  assert.match(packageSource, /consume_care_package_item_v2/);
  assert.match(packageSource, /p_request_key/);
  assert.match(packageSource, /p_quantity_total\?\?input\?\.p_quantity/);
  assert.match(packageSource, /p_item_type\|\|input\?\.p_category/);
  assert.match(billingSource, /add_care_package_item_v2/);
  assert.match(billingSource, /p_quantity:qty/);
  assert.match(billingSource, /p_category:'service'/);
});
