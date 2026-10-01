import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handleCloudflareAuthRuntime } from './cloudflare-auth-runtime.js';
import { cloudflarePasswordHash } from './cloudflare-auth-compat.js';

function fixture(active = false) {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['full-migration-schema.sql','runtime-schema.sql','migrations/0005-auth-recovery.sql','migrations/0009-billing-recovery.sql']) sqlite.exec(readFileSync(new URL(`../cloudflare/${file}`, import.meta.url),'utf8'));
  const wrap = (sql, args = []) => ({ bind: (...values) => wrap(sql,values), first: async () => sqlite.prepare(sql).get(...args) || null, run: async () => ({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}) });
  const db = {prepare:sql=>wrap(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
  const env = {CLINICAL_DB:db,CLINICAL_AUTH_SECRET:'test-secret',LICENSE_SERVICE_SECRET:'test-license-secret',ARTISYS_LICENSING:{fetch:async()=>Response.json({commercial:active,active,planCode:active?'pro_6m':'legacy_unmanaged',source:active?'mercado_livre_manual':'legacy'})}};
  return {sqlite,env};
}
const call = (env,path,body) => handleCloudflareAuthRuntime(new Request(`https://example.test/api/auth/${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),env);
async function pending(sqlite) {
  const salt = Buffer.from('test-salt').toString('base64url');
  const hash = await cloudflarePasswordHash('original-password',salt,100000);
  sqlite.prepare(`INSERT INTO billing_pending_signups(user_id,email,password_salt,password_hash,plan_code,signup_nonce_hash) VALUES(?,?,?,?,?,?)`).run('pending-user','new@example.test',salt,hash,'pro_monthly','old-nonce');
}
test('free signup reuses the pending Pro identity only with its password',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  assert.equal((await call(env,'signup',{email:'new@example.test',password:'attacker-password'})).status,400);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_users').get().n,0);
  const response=await call(env,'signup',{email:'new@example.test',password:'original-password'});
  assert.equal(response.status,200);assert.equal((await response.json()).user.id,'pending-user');
});
test('active manual license bypasses stale unpaid pending password and uses the password chosen on first access',async()=>{
  const {sqlite,env}=fixture(true);await pending(sqlite);
  const response=await call(env,'signup',{email:'new@example.test',password:'chosen-password'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).user.id,'pending-user');
  const account=sqlite.prepare('SELECT user_id,password_reset_required FROM auth_users WHERE email=?').get('new@example.test');
  assert.equal(account.user_id,'pending-user');
  assert.equal(account.password_reset_required,0);
  const credential=sqlite.prepare('SELECT * FROM auth_credentials WHERE user_id=?').get('pending-user');
  assert.equal(credential.password_hash,await cloudflarePasswordHash('chosen-password',credential.password_salt,credential.password_iterations));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_signup_recovery_tokens').get().n,0);
  assert.equal((await call(env,'token?grant_type=password',{email:'new@example.test',password:'chosen-password'})).status,200);
});
test('manual license can finish a previously reserved password-reset identity without email recovery',async()=>{
  const {sqlite,env}=fixture(true);
  sqlite.prepare("INSERT INTO auth_users(user_id,email,password_reset_required,app_metadata_json) VALUES('reserved-user','granted@example.test',1,'{\"commercial_account\":true,\"mailbox_claim_required\":true}')").run();
  const response=await call(env,'signup',{email:'granted@example.test',password:'owner-password'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).user.id,'reserved-user');
  assert.equal(sqlite.prepare("SELECT password_reset_required FROM auth_users WHERE user_id='reserved-user'").get().password_reset_required,0);
  const credential=sqlite.prepare("SELECT * FROM auth_credentials WHERE user_id='reserved-user'").get();
  assert.equal(credential.password_hash,await cloudflarePasswordHash('owner-password',credential.password_salt,credential.password_iterations));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_recovery_tokens').get().n,0);
  assert.equal((await call(env,'token?grant_type=password',{email:'granted@example.test',password:'owner-password'})).status,200);
});
test('paid Asaas pending identity keeps password activation even when a manual commercial license is active',async()=>{
  const {sqlite,env}=fixture(true);await pending(sqlite);
  sqlite.prepare("UPDATE billing_pending_signups SET status='paid',payment_confirmed_at=? WHERE user_id='pending-user'").run(new Date().toISOString());
  assert.equal((await call(env,'signup',{email:'new@example.test',password:'chosen-password'})).status,400);
  const response=await call(env,'signup',{email:'new@example.test',password:'original-password'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).user.id,'pending-user');
  assert.equal(sqlite.prepare('SELECT password_reset_required FROM auth_users WHERE user_id=?').get('pending-user').password_reset_required,0);
});
test('active manual license with no pending checkout creates credentials directly',async()=>{
  const {sqlite,env}=fixture(true);
  const response=await call(env,'signup',{email:'granted@example.test',password:'owner-password'});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.user.email,'granted@example.test');
  assert.equal(sqlite.prepare('SELECT password_reset_required FROM auth_users WHERE email=?').get('granted@example.test').password_reset_required,0);
  const credential=sqlite.prepare('SELECT * FROM auth_credentials WHERE user_id=?').get(body.user.id);
  assert.equal(credential.password_hash,await cloudflarePasswordHash('owner-password',credential.password_salt,credential.password_iterations));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_recovery_tokens').get().n,0);
});
test('non-manual active pregrant still uses mailbox recovery',async()=>{
  const {sqlite,env}=fixture(false);
  env.ARTISYS_LICENSING.fetch=async()=>Response.json({commercial:true,active:true,planCode:'pro_annual',source:'asaas'});
  let delivered;
  env.AUTH_RECOVERY_ORIGIN='https://example.test';
  env.AUTH_RECOVERY_DELIVERY={fetch:async request=>{delivered=await request.json();return Response.json({ok:true});}};
  const response=await call(env,'signup',{email:'other-grant@example.test',password:'submitted-password'});
  assert.equal(response.status,202);
  assert.equal(delivered.to,'other-grant@example.test');
  assert.equal(sqlite.prepare('SELECT password_reset_required FROM auth_users WHERE email=?').get('other-grant@example.test').password_reset_required,1);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_credentials').get().n,0);
});
test('pending recovery resets credential and nonce without activating account; token is single-use',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  let delivered;
  env.AUTH_RECOVERY_ORIGIN='https://example.test';
  env.AUTH_RECOVERY_DELIVERY={fetch:async request=>{delivered=await request.json();return Response.json({ok:true});}};
  assert.equal((await call(env,'recovery',{email:'new@example.test'})).status,202);
  assert.equal(delivered.to,'new@example.test');
  const token=new URLSearchParams(new URL(delivered.recoveryUrl).hash.slice(1)).get('recovery_token');
  assert.equal((await call(env,'reset-password',{token,password:'replacement-password'})).status,200);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_users').get().n,0);
  const saved=sqlite.prepare('SELECT * FROM billing_pending_signups').get();
  assert.notEqual(saved.signup_nonce_hash,'old-nonce');
  assert.equal(saved.password_hash,await cloudflarePasswordHash('replacement-password',saved.password_salt,saved.password_iterations));
  assert.equal((await call(env,'reset-password',{token,password:'another-password'})).status,400);
  assert.equal((await call(env,'signup',{email:saved.email,password:'original-password'})).status,400);
  assert.equal((await call(env,'signup',{email:saved.email,password:'replacement-password'})).status,200);
});
test('pending recovery also updates same identity activated before reset',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  let delivered;
  env.AUTH_RECOVERY_ORIGIN='https://example.test';
  env.AUTH_RECOVERY_DELIVERY={fetch:async request=>{delivered=await request.json();return Response.json({ok:true});}};
  await call(env,'recovery',{email:'new@example.test'});
  await call(env,'signup',{email:'new@example.test',password:'original-password'});
  const token=new URLSearchParams(new URL(delivered.recoveryUrl).hash.slice(1)).get('recovery_token');
  assert.equal((await call(env,'reset-password',{token,password:'replacement-password'})).status,200);
  const saved=sqlite.prepare('SELECT * FROM auth_credentials').get();
  assert.equal(saved.password_hash,await cloudflarePasswordHash('replacement-password',saved.password_salt,saved.password_iterations));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_refresh_sessions WHERE revoked_at IS NULL').get().n,0);
});
test('expired pending recovery does not change password or activate an account',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  const token=Buffer.alloc(32,7).toString('base64url');
  const tokenHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('base64url');
  sqlite.prepare('INSERT INTO billing_signup_recovery_tokens VALUES(?,?,?,?)').run(tokenHash,'pending-user','2000-01-01T00:00:00.000Z','1999-01-01T00:00:00.000Z');
  const before=sqlite.prepare('SELECT * FROM billing_pending_signups').get();
  assert.equal((await call(env,'reset-password',{token,password:'replacement-password'})).status,400);
  assert.deepEqual(sqlite.prepare('SELECT * FROM billing_pending_signups').get(),before);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_users').get().n,0);
});
test('stale pending signup must not issue a session if recovery and activation won the race',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  const batch=env.CLINICAL_DB.batch;
  env.CLINICAL_DB.batch=async statements=>{
    sqlite.prepare('UPDATE billing_pending_signups SET password_hash=?').run('changed-by-recovery');
    sqlite.prepare("INSERT INTO auth_users(user_id,email,password_reset_required) VALUES('pending-user','new@example.test',0)").run();
    return batch(statements);
  };
  const response=await call(env,'signup',{email:'new@example.test',password:'original-password'});
  assert.equal(response.status,409);
  assert.equal(sqlite.prepare('SELECT count(*) n FROM auth_refresh_sessions').get().n,0);
});
test('concurrent reset attempts consume one pending token exactly once',async()=>{
  const {sqlite,env}=fixture();await pending(sqlite);
  const token=Buffer.alloc(32,9).toString('base64url');
  const tokenHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('base64url');
  sqlite.prepare('INSERT INTO billing_signup_recovery_tokens VALUES(?,?,?,?)').run(tokenHash,'pending-user',new Date(Date.now()+60000).toISOString(),new Date().toISOString());
  const batch=env.CLINICAL_DB.batch;
  let queue=Promise.resolve();
  // D1 serializes its transactions; retain that property in the async adapter.
  env.CLINICAL_DB.batch=statements=>{const result=queue.then(()=>batch(statements));queue=result.catch(()=>{});return result;};
  const passwords=['replacement-password-a','replacement-password-b'];
  const responses=await Promise.all(passwords.map(password=>call(env,'reset-password',{token,password})));
  assert.deepEqual(responses.map(response=>response.status).sort(),[200,400]);
  const saved=sqlite.prepare('SELECT * FROM billing_pending_signups').get();
  const winner=passwords[responses.findIndex(response=>response.status===200)];
  assert.equal(saved.password_hash,await cloudflarePasswordHash(winner,saved.password_salt,saved.password_iterations));
  assert.equal(sqlite.prepare('SELECT count(*) n FROM billing_signup_recovery_tokens').get().n,0);
});
