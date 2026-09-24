import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeGrowthRuntimeSource } from '../scripts/normalize-growth-runtime.mjs';
const source=normalizeGrowthRuntimeSource(readFileSync('patch-source/legacy/growth-feature.supabase-template.js','utf8'));
function dbFor(client){
  const code=source.slice(source.indexOf('async function db('),source.indexOf('const E='));
  return vm.runInNewContext(`${code};db`,{window:{DeboraRuntimeClient:client}});
}
test('growth reads and writes use the canonical session-aware client',async()=>{
  const calls=[];
  const db=dbFor({rest:async(...args)=>{calls.push(args);return [{id:'baby-a'}];}});
  assert.equal((await db('babies?mother_id=eq.mother-a'))[0].id,'baby-a');
  await db('babies?id=eq.baby-a',{method:'PATCH',body:JSON.stringify({sex:'female'}),headers:{Prefer:'return=representation'}});
  assert.equal(calls[0][0],'babies');assert.equal(calls[0][1].query,'mother_id=eq.mother-a');
  assert.equal(calls[1][1].body.sex,'female');assert.equal(calls[1][1].method,'PATCH');
});
test('growth measurement uses RPC instead of the generic records/rpc route',async()=>{
  let call;
  const db=dbFor({rpc:async(...args)=>{call=args;return {ok:true};}});
  await db('rpc/record_growth_measurement',{method:'POST',body:'{"p_baby_id":"baby-a","p_weight_g":3500}'});
  assert.equal(call[0],'record_growth_measurement');assert.equal(call[1].p_baby_id,'baby-a');
});
test('growth does not bypass auth when the canonical client is not ready',async()=>{
  await assert.rejects(dbFor(null)('babies'),/iniciando/);
});
test('frequent DOM mutations cannot indefinitely postpone curve mounting',()=>{
  const start=source.indexOf('function gfScheduleV3()');
  const end=source.indexOf('function gfRouteResetV3()',start);
  const callbacks=[];let mounted=0;
  const schedule=vm.runInNewContext(`let gfTimerV3;${source.slice(start,end)};gfScheduleV3`,{
    setTimeout(fn){callbacks.push(fn);return callbacks.length;},
    gfEnhanceV3(){mounted++;},
    clearTimeout(){throw new Error('pending mount must not be cancelled');}
  });
  for(let i=0;i<100;i++)schedule();
  assert.equal(callbacks.length,1);callbacks[0]();assert.equal(mounted,1);
  schedule();assert.equal(callbacks.length,2);
});
