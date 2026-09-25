import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { observabilitySummary, listObservedUsers, listObservedSales, listUserSessions } from '../worker/usage-observability-queries.js';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE auth_users(user_id TEXT PRIMARY KEY,email TEXT,created_at TEXT,last_sign_in_at TEXT);
    CREATE TABLE billing_pending_signups(user_id TEXT PRIMARY KEY,email TEXT);
    CREATE TABLE billing_checkout_requests(id TEXT PRIMARY KEY,owner_id TEXT,plan_code TEXT,provider TEXT,status TEXT,external_checkout_id TEXT,subtotal_cents INTEGER,discount_cents INTEGER,total_cents INTEGER,created_at TEXT,updated_at TEXT);
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY,owner_id TEXT,provider TEXT,plan_code TEXT,status TEXT,current_period_end TEXT,updated_at TEXT,UNIQUE(owner_id,provider));
    CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,current_session_id TEXT,last_heartbeat_id TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE user_usage_daily(user_id TEXT NOT NULL,usage_date TEXT NOT NULL,session_count INTEGER NOT NULL DEFAULT 0,active_seconds INTEGER NOT NULL DEFAULT 0,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(user_id,usage_date));
  `);
  const wrap = (statement) => ({
    bind(...args) {
      return {
        async first() { return statement.get(...args) ?? null; },
        async all() { return { results: statement.all(...args) }; },
        async run() { const result = statement.run(...args); return { meta: { changes: Number(result.changes || 0) } }; },
      };
    },
  });
  return { sqlite, prepare(sql) { return wrap(sqlite.prepare(sql)); } };
}

function assertAdministrativeOnly(payload) {
  const json = JSON.stringify(payload).toLowerCase();
  for (const forbidden of ['patient','mother','baby','clinical','diagnosis','referral','media']) {
    assert.equal(json.includes(forbidden), false, `payload leaked forbidden domain: ${forbidden}`);
  }
}

test('observability contracts expose only administrative account, billing and usage fields', async () => {
  const db = d1();
  const env = { CLINICAL_DB: db };
  db.sqlite.prepare('INSERT INTO auth_users(user_id,email,created_at,last_sign_in_at) VALUES(?,?,?,?)')
    .run('u1','safe@example.test','2026-09-25T10:00:00.000Z','2026-09-25T11:00:00.000Z');
  db.sqlite.prepare('INSERT INTO user_presence VALUES(?,?,?,?,?,?)')
    .run('u1','2026-09-25T10:00:00.000Z','2026-09-25T11:59:30.000Z','s1','h1','2026-09-25T11:59:30.000Z');
  db.sqlite.prepare('INSERT INTO user_sessions VALUES(?,?,?,?,?,?,?)')
    .run('s1','u1','2026-09-25T10:00:00.000Z','2026-09-25T11:59:30.000Z',null,3600,'2026-09-25T10:00:00.000Z');
  db.sqlite.prepare('INSERT INTO user_usage_daily VALUES(?,?,?,?,?,?)')
    .run('u1','2026-09-25',1,3600,'2026-09-25T10:00:00.000Z','2026-09-25T11:59:30.000Z');
  db.sqlite.prepare('INSERT INTO billing_checkout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run('c1','u1','pro_monthly','asaas','paid','external-1',9990,0,9990,'2026-09-25T09:00:00.000Z','2026-09-25T09:01:00.000Z');
  db.sqlite.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?,?,?)')
    .run('sub1','u1','asaas','pro_monthly','active','2026-10-25T00:00:00.000Z','2026-09-25T09:01:00.000Z');

  const now = new Date('2026-09-25T12:00:00.000Z');
  const payloads = [
    await observabilitySummary(env, now),
    await listObservedUsers(env, { limit: '50' }, now),
    await listObservedSales(env, { limit: '50' }),
    await listUserSessions(env, 'u1', { limit: '25' }),
  ];

  for (const payload of payloads) assertAdministrativeOnly(payload);
});
