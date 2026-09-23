import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { handleCloudflareGrowthRuntime } from '../worker/cloudflare-growth-runtime.js';

async function readCanonicalArtifact(relativePath) {
  const dist = new URL(`../dist/${relativePath}`, import.meta.url);
  try {
    await access(dist);
    return readFile(dist, 'utf8');
  } catch {
    return readFile(new URL(`../public/${relativePath}`, import.meta.url), 'utf8');
  }
}

class FakeStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async first() { return this.db.first(this.sql, this.args); }
  async all() { return this.db.all(this.sql, this.args); }
  async run() { return this.db.run(this.sql, this.args); }
}

class FakeD1 {
  constructor() { this.records = new Map(); }
  prepare(sql) { return new FakeStatement(this, sql); }
  seed(table, key, ownerId, record) {
    this.records.set(`${table}:${key}`, { table, key, ownerId, record: { ...record } });
  }
  async first(sql, args) {
    if (/FROM supabase_records\s+WHERE table_name = \? AND owner_id = \?/i.test(sql)) {
      const [table, ownerId, firstId, secondId] = args;
      if (/record_key = \? OR json_extract\(record_json,'\$\.id'\) = \?/i.test(sql)) {
        return this.row([...this.records.values()].find((entry) => entry.table === table
          && String(entry.ownerId || '') === String(ownerId)
          && (String(entry.key) === String(firstId) || String(entry.record?.id || '') === String(secondId))));
      }
    }
    if (/table_name = 'weights'/i.test(sql) && /json_extract\(record_json,'\$\.baby_id'\)/i.test(sql)) {
      const [ownerId, babyId] = args;
      const latest = [...this.records.values()]
        .filter((entry) => entry.table === 'weights'
          && String(entry.ownerId || '') === String(ownerId)
          && String(entry.record?.baby_id || '') === String(babyId)
          && entry.record?.weight_g != null)
        .sort((a, b) => Date.parse(b.record.measured_at) - Date.parse(a.record.measured_at))[0];
      return latest ? { record_json: JSON.stringify(latest.record) } : null;
    }
    throw new Error(`unexpected first SQL: ${sql}`);
  }
  async all(sql, args) {
    if (/FROM supabase_records WHERE table_name = \? AND owner_id = \?/i.test(sql)) {
      const [table, ownerId] = args;
      return { results: [...this.records.values()]
        .filter((entry) => entry.table === table && String(entry.ownerId || '') === String(ownerId))
        .map((entry) => this.row(entry)) };
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }
  row(entry) {
    return entry ? { record_key: entry.key, owner_id: entry.ownerId, record_json: JSON.stringify(entry.record) } : null;
  }
  async run(sql, args) {
    if (/INSERT INTO supabase_records/i.test(sql)) {
      const [table, key, ownerId, recordJson] = args;
      this.seed(String(table), String(key), ownerId, JSON.parse(recordJson));
      return { success: true };
    }
    throw new Error(`unexpected run SQL: ${sql}`);
  }
  async batch(statements) {
    const snapshot = new Map(this.records);
    try {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    } catch (error) {
      this.records = snapshot;
      throw error;
    }
  }
}

function growthRequest(body) {
  return new Request('https://app.test/api/clinical/rpc/record_growth_measurement', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function growthDeps() {
  let n = 0;
  return {
    authenticate: async () => ({ id: 'user-1' }),
    now: '2026-09-23T15:00:00.000Z',
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  };
}

function growthDb() {
  const db = new FakeD1();
  db.seed('babies', 'baby-1', 'user-1', {
    id: 'baby-1', owner_id: 'user-1', mother_id: 'mother-1', current_weight_g: 5000,
  });
  return db;
}

test('R20 rejects zero, negative and non-finite growth values', async () => {
  for (const body of [
    { p_baby_id: 'baby-1', p_weight_g: 0 },
    { p_baby_id: 'baby-1', p_weight_g: -100 },
    { p_baby_id: 'baby-1', p_weight_g: 'Infinity' },
  ]) {
    const response = await handleCloudflareGrowthRuntime(growthRequest(body), { CLINICAL_DB: growthDb() }, undefined, growthDeps());
    assert.equal(response.status, 400, JSON.stringify(body));
  }
});

test('R20 rejects invalid or future measurement dates', async () => {
  for (const measuredAt of ['not-a-date', '2026-09-24T15:00:00.000Z']) {
    const response = await handleCloudflareGrowthRuntime(
      growthRequest({ p_baby_id: 'baby-1', p_weight_g: 5100, p_measured_at: measuredAt }),
      { CLINICAL_DB: growthDb() }, undefined, growthDeps(),
    );
    assert.equal(response.status, 400, measuredAt);
  }
});

test('R20 historical weight is stored without replacing a newer current weight', async () => {
  const db = growthDb();
  db.seed('weights', 'weight-newer', 'user-1', {
    id: 'weight-newer', owner_id: 'user-1', baby_id: 'baby-1', weight_g: 5200,
    measured_at: '2026-09-20T12:00:00.000Z',
  });
  db.records.get('babies:baby-1').record.current_weight_g = 5200;

  const response = await handleCloudflareGrowthRuntime(
    growthRequest({ p_baby_id: 'baby-1', p_weight_g: 4800, p_measured_at: '2026-09-10T12:00:00.000Z' }),
    { CLINICAL_DB: db }, undefined, growthDeps(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.baby.current_weight_g, 5200);
  assert.equal(db.records.get('babies:baby-1').record.current_weight_g, 5200);
  assert.ok([...db.records.values()].some((entry) => entry.table === 'weights' && entry.record.weight_g === 4800));
});

test('R18 old appointment delete UI uses canonical RPC and does not promise clinical-record deletion', async () => {
  const source = await readCanonicalArtifact('clinical-source/features/patient-fixes.js');
  assert.doesNotMatch(source, /rpc\/delete_appointment/);
  assert.match(source, /delete_scheduled_appointment/);
  assert.doesNotMatch(source, /agendamento e o prontuário clínico vinculado serão removidos/i);
  assert.match(source, /Agendamento excluído/);
});

test('C06 patient plan invalidates previous identity before awaiting the new package and renders explicit error state', async () => {
  const source = await readCanonicalArtifact('billing-v2.js');
  const start = source.indexOf('async function bvMountPatientPlan');
  const end = source.indexOf('function bvClosePlanDialog', start);
  const mount = source.slice(start, end);
  const loading = mount.indexOf('bvPlanLoadingMarkup');
  const request = mount.indexOf('await bvPatientPackage(mid)');
  assert.ok(loading >= 0 && request >= 0 && loading < request, 'loading/identity invalidation must happen before package request');
  assert.match(mount, /dataset\.motherId=mid/);
  assert.match(mount, /bvPlanErrorMarkup/);
  assert.match(mount, /data-bv-plan-retry/);
});

test('C07 encounter history uses canonical refresh-capable client and surfaces read failure instead of empty history', async () => {
  const source = await readCanonicalArtifact('clinical-source/features/patient-fixes.js');
  const encounterStart = source.indexOf('async function pfEncounterRows');
  const encounterEnd = source.indexOf('async function pfMountProntuario', encounterStart);
  const encounter = source.slice(encounterStart, encounterEnd);
  assert.doesNotMatch(encounter, /catch\(\(\)=>\[\]\)/);
  assert.match(source, /DeboraRuntimeClient/);
  assert.match(source, /Não foi possível carregar os prontuários/);
  assert.match(source, /data-pf-prontuario-retry/);
});
