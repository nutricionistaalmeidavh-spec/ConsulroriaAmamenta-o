import test from 'node:test';
import assert from 'node:assert/strict';
import { handleBlock6RpcRuntime } from '../worker/block6-rpc-runtime.js';

class FakeStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async all() { return this.db.all(this.sql, this.args); }
  async run() { return this.db.run(this.sql, this.args); }
}
class FakeD1 {
  constructor() { this.records = new Map(); }
  prepare(sql) { return new FakeStatement(this, sql); }
  seed(table, key, ownerId, record) { this.records.set(`${table}:${key}`, { table, key, ownerId, record: { ...record } }); }
  async all(sql, args) {
    if (/SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = \?/i.test(sql)) {
      const table = String(args[0]);
      return { results: [...this.records.values()].filter((row) => row.table === table).map((row) => ({
        record_key: row.key, owner_id: row.ownerId, record_json: JSON.stringify(row.record),
      })) };
    }
    throw new Error(`unexpected all SQL: ${sql}`);
  }
  async run() { throw new Error('unexpected write'); }
}

const member = { id: 'member-user-1', email: 'mae@example.test' };
const authenticate = async () => member;
function req() { return new Request('https://app.test/api/clinical/records/portal_content?select=*&owner_id=eq.professional-1&order=position.asc'); }
function seedBase(db, tier) {
  db.seed('member_portal_access', 'access-1', 'professional-1', {
    id: 'access-1', owner_id: 'professional-1', mother_id: 'mother-1', email: member.email,
    member_user_id: member.id, tier, active: true,
  });
  db.seed('portal_content', 'free', 'professional-1', { id: 'free', owner_id: 'professional-1', min_tier: 'free', active: true, position: 1 });
  db.seed('portal_content', 'essential', 'professional-1', { id: 'essential', owner_id: 'professional-1', min_tier: 'essential', active: true, position: 2 });
  db.seed('portal_content', 'premium', 'professional-1', { id: 'premium', owner_id: 'professional-1', min_tier: 'premium', active: true, position: 3 });
}

for (const [tier, expected] of [
  ['free', ['free']],
  ['essential', ['free', 'essential']],
  ['premium', ['free', 'essential', 'premium']],
]) {
  test(`portal_content enforces ${tier} tier`, async () => {
    const db = new FakeD1();
    seedBase(db, tier);
    const response = await handleBlock6RpcRuntime(req(), { CLINICAL_DB: db }, new URL(req().url), { authenticate });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).map((row) => row.id), expected);
  });
}

test('an explicit bonus unlock grants one higher-tier content item only to the claimed mother', async () => {
  const db = new FakeD1();
  seedBase(db, 'free');
  db.seed('member_content_unlocks', 'unlock-1', 'professional-1', {
    id: 'unlock-1', owner_id: 'professional-1', mother_id: 'mother-1', content_id: 'premium', active: true,
  });
  db.seed('member_content_unlocks', 'unlock-other', 'professional-1', {
    id: 'unlock-other', owner_id: 'professional-1', mother_id: 'mother-2', content_id: 'essential', active: true,
  });
  const response = await handleBlock6RpcRuntime(req(), { CLINICAL_DB: db }, new URL(req().url), { authenticate });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).map((row) => row.id), ['free', 'premium']);
});
