import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { recordUsageHeartbeat, closeUsageSession, cleanupExpiredUsageSessions } from './usage-presence-service.js';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE user_presence(user_id TEXT PRIMARY KEY,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,current_session_id TEXT,last_heartbeat_id TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE user_sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,started_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,ended_at TEXT,duration_seconds INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
    CREATE TABLE user_usage_daily(user_id TEXT NOT NULL,usage_date TEXT NOT NULL,session_count INTEGER NOT NULL DEFAULT 0,active_seconds INTEGER NOT NULL DEFAULT 0,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(user_id,usage_date));
  `);
  const wrap = (stmt) => ({
    bind(...args) { const bound = stmt; return {
      async first(){ return bound.get(...args) ?? null; },
      async all(){ return {results: bound.all(...args)}; },
      async run(){ const r = bound.run(...args); return {meta:{changes:r.changes}}; },
    }; },
    async first(){ return stmt.get() ?? null; },
    async all(){ return {results:stmt.all()}; },
    async run(){ const r=stmt.run(); return {meta:{changes:r.changes}}; },
  });
  let queue = Promise.resolve();
  return {
    sqlite,
    prepare(sql){ return wrap(sqlite.prepare(sql)); },
    batch(statements){
      const job = queue.then(async()=>{
        sqlite.exec('BEGIN IMMEDIATE');
        try { const out=[]; for (const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
        catch (e) { sqlite.exec('ROLLBACK'); throw e; }
      });
      queue = job.catch(()=>{});
      return job;
    },
  };
}

const envFor = db => ({CLINICAL_DB:db});

test('tracks first heartbeat, continuation, capped increment and gap without retroactive idle time', async () => {
  const db=makeDb(), env=envFor(db), user='u1';
  const first=await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:00:00Z'));
  assert.equal(first.newSession,true); assert.equal(first.addedSeconds,0);
  const second=await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:01:00Z'));
  assert.equal(second.newSession,false); assert.equal(second.addedSeconds,60);
  const capped=await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:03:00Z'));
  assert.equal(capped.addedSeconds,90);
  const gap=await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:20:00Z'));
  assert.equal(gap.newSession,true); assert.equal(gap.addedSeconds,0);
  const rows=db.sqlite.prepare('SELECT duration_seconds FROM user_sessions ORDER BY started_at').all();
  assert.deepEqual(rows.map(r=>r.duration_seconds),[150,0]);
  const usage=db.sqlite.prepare('SELECT session_count,active_seconds FROM user_usage_daily WHERE user_id=?').get(user);
  assert.equal(usage.session_count,2); assert.equal(usage.active_seconds,150);
});

test('ignores delayed heartbeats and concurrent claims cannot double count an interval', async () => {
  const db=makeDb(), env=envFor(db), user='u2';
  await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:00:00Z'));
  await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:01:00Z'));
  const before=db.sqlite.prepare('SELECT duration_seconds FROM user_sessions WHERE user_id=?').get(user).duration_seconds;
  await recordUsageHeartbeat(env,user,new Date('2026-09-25T12:00:30Z'));
  assert.equal(db.sqlite.prepare('SELECT last_seen_at FROM user_presence WHERE user_id=?').get(user).last_seen_at,'2026-09-25T12:01:00.000Z');
  assert.equal(db.sqlite.prepare('SELECT duration_seconds FROM user_sessions WHERE user_id=?').get(user).duration_seconds,before);
  await Promise.all([
    recordUsageHeartbeat(env,user,new Date('2026-09-25T12:02:00Z')),
    recordUsageHeartbeat(env,user,new Date('2026-09-25T12:02:00Z')),
  ]);
  assert.equal(db.sqlite.prepare('SELECT duration_seconds FROM user_sessions WHERE user_id=?').get(user).duration_seconds,120);
});

test('splits active seconds across UTC day boundary and counts one active session on the new day', async () => {
  const db=makeDb(), env=envFor(db), user='u3';
  await recordUsageHeartbeat(env,user,new Date('2026-09-25T23:59:30Z'));
  await recordUsageHeartbeat(env,user,new Date('2026-09-26T00:00:30Z'));
  const rows=db.sqlite.prepare('SELECT usage_date,session_count,active_seconds FROM user_usage_daily WHERE user_id=? ORDER BY usage_date').all(user).map(r=>({...r}));
  assert.deepEqual(rows,[
    {usage_date:'2026-09-25',session_count:1,active_seconds:30},
    {usage_date:'2026-09-26',session_count:1,active_seconds:30},
  ]);
});

test('logout closes the current session without deleting presence history', async () => {
  const db=makeDb(), env=envFor(db), user='u4';
  await recordUsageHeartbeat(env,user,new Date('2026-09-25T10:00:00Z'));
  const result=await closeUsageSession(env,user,new Date('2026-09-25T10:01:00Z'));
  assert.equal(result.closed,true);
  assert.equal(db.sqlite.prepare('SELECT current_session_id FROM user_presence WHERE user_id=?').get(user).current_session_id,null);
  assert.equal(db.sqlite.prepare('SELECT ended_at FROM user_sessions WHERE user_id=?').get(user).ended_at,'2026-09-25T10:01:00.000Z');
});

test('cleanup deletes only the bounded old-session batch', async () => {
  const db=makeDb(), env=envFor(db);
  const insert=db.sqlite.prepare('INSERT INTO user_sessions(id,user_id,started_at,last_seen_at,ended_at,duration_seconds,created_at) VALUES(?,?,?,?,?,?,?)');
  for(let i=0;i<250;i++) insert.run(`old-${i}`,'u','2025-01-01T00:00:00Z','2025-01-01T00:01:00Z','2025-01-01T00:01:00Z',60,'2025-01-01T00:00:00Z');
  for(let i=0;i<10;i++) insert.run(`new-${i}`,'u','2026-09-01T00:00:00Z','2026-09-01T00:01:00Z','2026-09-01T00:01:00Z',60,'2026-09-01T00:00:00Z');
  assert.equal((await cleanupExpiredUsageSessions(env,{beforeIso:'2026-01-01T00:00:00Z',limit:200})).deleted,200);
  assert.equal((await cleanupExpiredUsageSessions(env,{beforeIso:'2026-01-01T00:00:00Z',limit:200})).deleted,50);
  assert.equal(db.sqlite.prepare("SELECT count(*) n FROM user_sessions WHERE id LIKE 'new-%'").get().n,10);
});
