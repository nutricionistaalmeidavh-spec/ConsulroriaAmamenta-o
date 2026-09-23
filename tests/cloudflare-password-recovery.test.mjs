import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleCloudflareAuthRuntime as handle } from '../worker/cloudflare-auth-runtime.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('cloudflare/full-migration-schema.sql','utf8'));
  sqlite.exec(readFileSync('cloudflare/runtime-schema.sql','utf8'));
  const db = { prepare(sql) { return { bind(...args) { return {
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async run() { const r=sqlite.prepare(sql).run(...args); return {meta:{changes:r.changes}}; }
  }; } }; }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const out=[]; for(const s of statements) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
    catch(e) { sqlite.exec('ROLLBACK'); throw e; }
  }};
  return {sqlite,db};
}
const req=(path,body)=>new Request(`https://app.test${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('D1 recovery: private, hashed, expiring, one-use; password and refresh credentials rotate without network fallback',async()=>{
  const {sqlite,db}=database(); const messages=[];
  const env={CLINICAL_DB:db,CLINICAL_AUTH_SECRET:'test-secret',AUTH_RECOVERY_ORIGIN:'https://app.test',AUTH_RECOVERY_DELIVERY:{async fetch(request){messages.push(await request.json());return new Response(null,{status:204});}}};
  const original=globalThis.fetch; globalThis.fetch=()=>{throw new Error('external network forbidden');};
  try {
    const signup=await handle(req('/api/auth/signup',{email:'synthetic@example.test',password:'old-password'}),env);
    const session=await signup.json(); assert.equal(signup.status,200);
    const ask=()=>handle(req('/api/auth/recovery',{email:'synthetic@example.test'}),env);
    const first=await ask(); assert.equal(first?.status,202);
    const unknown=await handle(req('/api/auth/recovery',{email:'unknown@example.test'}),env);
    assert.deepEqual(await first.json(),await unknown.json()); assert.equal(messages.length,1);
    const token=()=>new URL(messages.at(-1).recoveryUrl).hash.slice('#recovery_token='.length);
    const reset=(t,password='new-password')=>handle(req('/api/auth/reset-password',{token:t,password}),env);
    const row=sqlite.prepare('SELECT * FROM auth_recovery_tokens').get();
    assert.ok(row.token_hash); assert.ok(!JSON.stringify(row).includes(token()));
    assert.equal((await reset('invalid')).status,400);
    sqlite.exec("UPDATE auth_recovery_tokens SET expires_at='2000-01-01T00:00:00.000Z', created_at='2000-01-01T00:00:00.000Z'");
    assert.equal((await reset(token())).status,400);
    await ask(); const valid=token();
    assert.equal((await reset(valid)).status,200);
    assert.equal((await reset(valid,'another-password')).status,400);
    for(const [password,status] of [['old-password',400],['new-password',200]]) {
      assert.equal((await handle(req('/api/auth/token?grant_type=password',{email:'synthetic@example.test',password}),env)).status,status);
    }
    assert.equal((await handle(req('/api/auth/token?grant_type=refresh_token',{refresh_token:session.refresh_token}),env)).status,401);
    const unavailable={...env,AUTH_RECOVERY_DELIVERY:undefined};
    for(const email of ['synthetic@example.test','unknown@example.test']) assert.equal((await handle(req('/api/auth/recovery',{email}),unavailable)).status,503);
    assert.equal((await handle(req('/api/auth/reset-password',{token:valid,password:'new-password'}),{})).status,503);
  } finally { globalThis.fetch=original; sqlite.close(); }
});
