import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

function details(db, sql, ...params) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail || '')).join('\n');
}

test('critical observability queries use growth-table indexes', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,last_seen_at TEXT NOT NULL);
    CREATE INDEX user_presence_last_seen_idx ON user_presence(last_seen_at DESC,user_id);

    CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started_at TEXT NOT NULL,last_seen_at TEXT NOT NULL);
    CREATE INDEX user_sessions_user_started_idx ON user_sessions(user_id,started_at DESC,id DESC);

    CREATE TABLE billing_checkout_requests(id TEXT PRIMARY KEY,provider TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE INDEX billing_checkout_observability_idx ON billing_checkout_requests(provider,status,created_at DESC,id DESC);
  `);

  const online = details(db,
    'SELECT COUNT(*) FROM user_presence WHERE last_seen_at >= ?',
    '2026-09-25T11:58:00.000Z');
  assert.match(online, /user_presence_last_seen_idx/i);

  const sessions = details(db,
    'SELECT id FROM user_sessions WHERE user_id=? ORDER BY started_at DESC,id DESC LIMIT ?',
    'u1', 26);
  assert.match(sessions, /user_sessions_user_started_idx/i);

  const sales = details(db,
    "SELECT id FROM billing_checkout_requests WHERE provider='asaas' AND status=? ORDER BY created_at DESC,id DESC LIMIT ?",
    'paid', 51);
  assert.match(sales, /billing_checkout_observability_idx/i);
});
