import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRuntime,credentials} from './helpers/cloudflare-local.mjs';
test('actual local D1 atomically accepts only one concurrent reset',async()=>{
  const runtime=await createLocalRuntime();
  try {
    const post=(path,data)=>runtime.mf.dispatchFetch('https://app.test'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('/api/auth/recovery',{email:credentials.email})).status,202);
    const token=new URL(runtime.recoveryMessages[0].recoveryUrl).hash.slice('#recovery_token='.length);
    const results=await Promise.all(['First-password-2026!','Second-password-2026!'].map(password=>post('/api/auth/reset-password',{token,password})));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
    const logins=await Promise.all(['First-password-2026!','Second-password-2026!'].map(password=>post('/api/auth/token?grant_type=password',{email:credentials.email,password})));
    assert.deepEqual(logins.map(r=>r.status).sort(),[200,400]);
  } finally {await runtime.close();}
});

test('actual D1 rolls back token, password and session changes when reset fails, then permits retry', async () => {
  const runtime = await createLocalRuntime();
  try {
    const post = (path, data) => runtime.mf.dispatchFetch('https://app.test' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const session = await runtime.login();
    await post('/api/auth/recovery', { email: credentials.email });
    const token = new URL(runtime.recoveryMessages[0].recoveryUrl).hash.slice('#recovery_token='.length);
    const before = await runtime.db.prepare('SELECT * FROM auth_recovery_tokens').first();
    // Fail late, after credential and refresh-session writes have run in the batch.
    await runtime.db.prepare(`CREATE TRIGGER fail_reset BEFORE UPDATE OF password_reset_required ON auth_users
      BEGIN SELECT RAISE(ABORT, 'injected reset persistence failure'); END`).run();
    const reset = () => post('/api/auth/reset-password', { token, password: 'Retry-password-2026!' });
    assert.equal((await reset()).status, 503);
    assert.deepEqual(await runtime.db.prepare('SELECT * FROM auth_recovery_tokens').first(), before);
    assert.equal((await post('/api/auth/token?grant_type=password', credentials)).status, 200);
    assert.equal((await post('/api/auth/token?grant_type=refresh_token', { refresh_token: session.refresh_token })).status, 200);
    assert.equal((await post('/api/auth/token?grant_type=password', { email: credentials.email, password: 'Retry-password-2026!' })).status, 400);
    await runtime.db.prepare('DROP TRIGGER fail_reset').run();
    assert.equal((await reset()).status, 200);
    assert.equal((await reset()).status, 400);
    assert.equal((await post('/api/auth/token?grant_type=password', credentials)).status, 400);
    assert.equal((await post('/api/auth/token?grant_type=password', { email: credentials.email, password: 'Retry-password-2026!' })).status, 200);
  } finally { await runtime.close(); }
});
