import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { cleanupExpiredUsageSessions } from './usage-presence-service.js';

function d1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE user_sessions(
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      ended_at TEXT,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            async run() {
              const result = statement.run(...args);
              return { meta: { changes: Number(result.changes || 0) } };
            },
          };
        },
      };
    },
  };
}

test('cleanup removes expired sessions in bounded batches and preserves recent rows', async () => {
  const db = d1();
  const insert = db.sqlite.prepare(`INSERT INTO user_sessions(
    id,user_id,started_at,last_seen_at,ended_at,duration_seconds,created_at
  ) VALUES(?,?,?,?,?,?,?)`);

  for (let index = 0; index < 250; index += 1) {
    const id = `old-${String(index).padStart(3, '0')}`;
    insert.run(id, 'old-user', '2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z', '2024-01-01T00:01:00.000Z', 60, '2024-01-01T00:00:00.000Z');
  }
  for (let index = 0; index < 10; index += 1) {
    const id = `recent-${String(index).padStart(2, '0')}`;
    insert.run(id, 'recent-user', '2026-09-01T00:00:00.000Z', '2026-09-01T00:01:00.000Z', null, 60, '2026-09-01T00:00:00.000Z');
  }

  const env = { CLINICAL_DB: db };
  const cutoff = '2025-09-25T00:00:00.000Z';

  const first = await cleanupExpiredUsageSessions(env, { beforeIso: cutoff, limit: 200 });
  assert.equal(first.deleted, 200);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM user_sessions WHERE id LIKE 'old-%'").get().total, 50);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM user_sessions WHERE id LIKE 'recent-%'").get().total, 10);

  const second = await cleanupExpiredUsageSessions(env, { beforeIso: cutoff, limit: 200 });
  assert.equal(second.deleted, 50);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM user_sessions WHERE id LIKE 'old-%'").get().total, 0);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS total FROM user_sessions WHERE id LIKE 'recent-%'").get().total, 10);
});

test('cleanup clamps oversized batches to 500', async () => {
  const db = d1();
  const insert = db.sqlite.prepare(`INSERT INTO user_sessions(
    id,user_id,started_at,last_seen_at,ended_at,duration_seconds,created_at
  ) VALUES(?,?,?,?,?,?,?)`);
  for (let index = 0; index < 510; index += 1) {
    const id = `old-${String(index).padStart(3, '0')}`;
    insert.run(id, 'u', '2024-01-01T00:00:00.000Z', '2024-01-01T00:01:00.000Z', null, 60, '2024-01-01T00:00:00.000Z');
  }
  const result = await cleanupExpiredUsageSessions({ CLINICAL_DB: db }, { beforeIso: '2025-09-25T00:00:00.000Z', limit: 5000 });
  assert.equal(result.deleted, 500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS total FROM user_sessions').get().total, 10);
});

test('worker schedules a daily 12-month cleanup capped at 200 rows', () => {
  const worker = readFileSync('worker/domain-entry.js', 'utf8');
  const wrangler = readFileSync('wrangler.jsonc', 'utf8');
  assert.match(worker, /async scheduled\s*\(/);
  assert.match(worker, /365\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(worker, /cleanupExpiredUsageSessions\(env,\s*\{\s*beforeIso:\s*before,\s*limit:\s*200\s*\}\)/s);
  assert.match(worker, /usage session cleanup failed/);
  assert.match(wrangler, /"crons"\s*:\s*\[\s*"17 4 \* \* \*"\s*\]/);
});
