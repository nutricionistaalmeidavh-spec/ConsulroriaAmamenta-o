import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { encodeCursor, decodeCursor, observabilitySummary, listObservedUsers, listObservedSales, listUserSessions } from './usage-observability-queries.js';

function d1() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE auth_users(user_id TEXT PRIMARY KEY,email TEXT,created_at TEXT,last_sign_in_at TEXT);
    CREATE TABLE billing_pending_signups(user_id TEXT PRIMARY KEY,email TEXT);
    CREATE TABLE billing_checkout_requests(id TEXT PRIMARY KEY,owner_id TEXT,plan_code TEXT,provider TEXT,status TEXT,external_checkout_id TEXT,subtotal_cents INTEGER,discount_cents INTEGER,total_cents INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY,owner_id TEXT,provider TEXT,plan_code TEXT,status TEXT,current_period_end TEXT,updated_at TEXT,UNIQUE(owner_id,provider));
    CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,current_session_id TEXT,last_heartbeat_id TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE user_usage_daily(user_id TEXT NOT NULL,usage_date TEXT NOT NULL,session_count INTEGER NOT NULL DEFAULT 0,active_seconds INTEGER NOT NULL DEFAULT 0,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(user_id,usage_date));
    CREATE INDEX user_presence_last_seen_idx ON user_presence(last_seen_at DESC,user_id);
    CREATE INDEX user_sessions_user_started_idx ON user_sessions(user_id,started_at DESC,id DESC);
    CREATE INDEX billing_checkout_observability_idx ON billing_checkout_requests(provider,status,created_at DESC,id DESC);
  `);
  const wrap=stmt=>({bind(...args){return{async first(){return stmt.get(...args)??null},async all(){return{results:stmt.all(...args)}},async run(){const r=stmt.run(...args);return{meta:{changes:r.changes}}}}}});
  return {sqlite, prepare(sql){return wrap(sqlite.prepare(sql))}};
}
const env=db=>({CLINICAL_DB:db});

test('cursor round trips and rejects tampering',()=>{
  const value={sort:'2026-09-25T12:00:00.000Z',id:'u1'};
  assert.deepEqual(decodeCursor(encodeCursor(value)),value);
  assert.throws(()=>decodeCursor('%%%'),/invalid_cursor/);
});

test('users paginate stably, include legacy null dates, usage and online state',async()=>{
  const db=d1(), e=env(db);
  const ins=db.sqlite.prepare('INSERT INTO auth_users(user_id,email,created_at,last_sign_in_at) VALUES(?,?,?,?)');
  ins.run('u3','c@test','2026-09-25T12:00:00.000Z','2026-09-25T12:00:00.000Z');
  ins.run('u2','b@test','2026-09-25T12:00:00.000Z',null);
  ins.run('u1','a@test',null,null);
  db.sqlite.prepare('INSERT INTO user_presence VALUES(?,?,?,?,?,?)').run('u3','2026-09-25T11:00:00Z','2026-09-25T12:00:30.000Z','s3','h','2026-09-25T12:00:30Z');
  db.sqlite.prepare('INSERT INTO user_usage_daily VALUES(?,?,?,?,?,?)').run('u3','2026-09-25',2,180,'2026-09-25T11:00:00Z','2026-09-25T12:00:30Z');
  db.sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)').run('sub','u3','asaas','pro_monthly','active','2026-10-25','2026-09-25T12:00:00Z');
  const p1=await listObservedUsers(e,{limit:'2'},new Date('2026-09-25T12:01:00Z'));
  assert.deepEqual(p1.items.map(x=>x.userId),['u3','u2']); assert.equal(p1.hasMore,true); assert.ok(p1.nextCursor);
  assert.equal(p1.items[0].online,true); assert.equal(p1.items[0].activeSecondsToday,180); assert.equal(p1.items[0].planCode,'pro_monthly');
  const p2=await listObservedUsers(e,{limit:'2',cursor:p1.nextCursor},new Date('2026-09-25T12:01:00Z'));
  assert.deepEqual(p2.items.map(x=>x.userId),['u1']); assert.equal(p2.hasMore,false);
});

test('summary excludes sandbox from production billing and revenue',async()=>{
  const db=d1(), e=env(db);
  for (const [id,email,created] of [['u1','a@test','2026-09-25T10:00:00Z'],['u2','b@test','2026-09-20T10:00:00Z']]) db.sqlite.prepare('INSERT INTO auth_users(user_id,email,created_at) VALUES(?,?,?)').run(id,email,created);
  db.sqlite.prepare('INSERT INTO user_presence VALUES(?,?,?,?,?,?)').run('u1','2026-09-25T10:00:00Z','2026-09-25T11:59:30Z','s','h','2026-09-25T11:59:30Z');
  db.sqlite.prepare('INSERT INTO billing_checkout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('p','u1','pro_monthly','asaas','paid','x',9990,0,9990,'2026-09-25T10:00:00Z','2026-09-25T10:01:00Z');
  db.sqlite.prepare('INSERT INTO billing_checkout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('sb','u2','pro_monthly','asaas_sandbox','paid','x2',9990,0,9990,'2026-09-25T10:00:00Z','2026-09-25T10:01:00Z');
  db.sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)').run('s','u1','asaas','pro_annual','active','2027-09-25','2026-09-25T10:00:00Z');
  const s=await observabilitySummary(e,new Date('2026-09-25T12:00:00Z'));
  assert.equal(s.accounts.total,2); assert.equal(s.presence.onlineNow,1); assert.equal(s.billing.paid,1); assert.equal(s.billing.realizedRevenueCents,9990); assert.equal(s.subscriptions.active,1);
});

test('sales use production only and global merge boundary is deterministic',async()=>{
  const db=d1(), e=env(db);
  db.sqlite.prepare('INSERT INTO auth_users(user_id,email,created_at) VALUES(?,?,?)').run('u','a@test','2026-09-25T00:00:00Z');
  for (const id of ['A2','A1']) db.sqlite.prepare('INSERT INTO billing_checkout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,'u','pro_monthly','asaas','paid',id,9990,0,9990,'2026-09-25T12:00:00Z','2026-09-25T12:00:00Z');
  db.sqlite.prepare('INSERT INTO billing_checkout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('A0','u','pro_monthly','asaas','paid','A0',9990,0,9990,'2026-09-25T11:00:00Z','2026-09-25T11:00:00Z');
  const top=await listObservedSales(e,{limit:'2'}); assert.deepEqual(top.items.map(x=>x.checkoutId),['A2','A1']);
  const afterManualBoundary=await listObservedSales(e,{limit:'5',mergeCreatedAt:'2026-09-25T12:00:00Z',mergeSourceRank:'0',mergeId:'M1'});
  assert.deepEqual(afterManualBoundary.items.map(x=>x.checkoutId),['A0']);
});

test('sessions keyset handles tied timestamps without duplicates',async()=>{
  const db=d1(), e=env(db);
  for(const id of ['s3','s2','s1']) db.sqlite.prepare('INSERT INTO user_sessions VALUES(?,?,?,?,?,?,?)').run(id,'u','2026-09-25T12:00:00Z','2026-09-25T12:01:00Z',null,60,'2026-09-25T12:00:00Z');
  const p1=await listUserSessions(e,'u',{limit:'2'}); assert.deepEqual(p1.items.map(x=>x.id),['s3','s2']);
  const p2=await listUserSessions(e,'u',{limit:'2',cursor:p1.nextCursor}); assert.deepEqual(p2.items.map(x=>x.id),['s1']);
});
