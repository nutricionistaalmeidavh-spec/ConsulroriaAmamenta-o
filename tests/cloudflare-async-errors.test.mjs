import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCloudflareDataRuntime } from '../worker/cloudflare-data-runtime.js';
import { handleCloudflareAuthRuntime } from '../worker/cloudflare-auth-runtime.js';
const env={CLINICAL_DB:{prepare(){return {first:async()=>{throw new Error('synthetic outage');},bind(){return this;}};}}};
test('asynchronous D1 failures produce controlled JSON responses',async()=>{
  const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error('external fallback forbidden');};
  try {
    for(const [handle,request] of [
      [handleCloudflareDataRuntime,new Request('https://app.test/api/cloudflare/health')],
      [handleCloudflareAuthRuntime,new Request('https://app.test/api/auth/token?grant_type=password',{method:'POST',body:JSON.stringify({email:'synthetic@example.test',password:'test-password'})})],
    ]) { const response=await handle(request,env);assert.ok(response.status>=500);assert.match(response.headers.get('content-type'),/json/);assert.ok((await response.json()).error); }
  } finally {globalThis.fetch=original;}
});
