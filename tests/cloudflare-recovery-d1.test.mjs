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
    const resetDiagnostics=await Promise.all(results.map(async response=>({status:response.status,body:await response.clone().text()})));
    console.log('concurrent reset diagnostics',JSON.stringify(resetDiagnostics));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
    const logins=await Promise.all(['First-password-2026!','Second-password-2026!'].map(password=>post('/api/auth/token?grant_type=password',{email:credentials.email,password})));
    assert.deepEqual(logins.map(r=>r.status).sort(),[200,400]);
  } finally {await runtime.close();}
});
