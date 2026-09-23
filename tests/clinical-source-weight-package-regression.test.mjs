import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const weightSource=readFileSync('public/weight-evolution-v5.js','utf8');
const billingSource=readFileSync('public/billing-v2.js','utf8');

function storage(seed={}){
  const map=new Map(Object.entries(seed));
  return {
    get length(){return map.size},
    key(index){return [...map.keys()][index]??null},
    getItem(key){return map.has(key)?map.get(key):null},
    setItem(key,value){map.set(key,String(value))},
    removeItem(key){map.delete(key)}
  };
}

function response(body){
  return {
    ok:true,
    status:200,
    async text(){return JSON.stringify(body)}
  };
}

function billingRows(resource){
  const value=String(resource);
  if(value.includes('care_packages?'))return [{
    id:'package-1',service_label:'Plano de acompanhamento · 4 consultas',total_cents:76000,
    sessions_total:4,sessions_used:4,status:'active',payment_method:'Pix',created_at:'2026-09-01T00:00:00Z'
  }];
  if(value.includes('care_package_items?'))return [];
  if(value.includes('financial_entries?'))return [];
  return [];
}

test('weight evolution stylesheet is root-safe under the canonical /app entry',()=>{
  assert.match(weightSource,/link\.href=['"]\/weight-evolution-v5\.css['"]/);
});

test('three concurrent patient-plan remounts leave exactly one plan card',async()=>{
  const hosts=[];
  const anchor={insertAdjacentElement(_position,node){hosts.push(node)}};
  const screen={
    querySelector(selector){return selector==='.baby-selector-wrap'?anchor:null},
    querySelectorAll(selector){return selector==='[data-bv-patient-plan]'?[...hosts]:[]}
  };
  const document={
    documentElement:{},
    querySelector(selector){
      if(selector==='[data-screen="patient"]')return screen;
      if(selector==='[data-bv-patient-plan]')return hosts[0]||null;
      return null;
    },
    querySelectorAll(selector){return selector==='[data-bv-patient-plan]'?[...hosts]:[]},
    createElement(){
      return {
        dataset:{},
        className:'',
        innerHTML:'',
        querySelector(){return null},
        remove(){const index=hosts.indexOf(this);if(index>=0)hosts.splice(index,1)}
      };
    },
    addEventListener(){}
  };
  const sessionStorage=storage({'debora-runtime-access-token':'a.b.c'});
  const localStorage=storage();
  const context={
    console,
    document,
    location:{hash:'#/patient/mother-1'},
    sessionStorage,
    localStorage,
    MutationObserver:class{observe(){}},
    setTimeout(){return 1},
    clearTimeout(){},
    addEventListener(){},
    confirm(){return true},
    crypto:{randomUUID(){return '00000000-0000-4000-8000-000000000001'}},
    fetch:async url=>response(billingRows(String(url).replace(/^.*\/api\/clinical\/records\//,''))),
    DeboraRuntimeClient:{
      getSession(){return{access_token:'a.b.c'}},
      async rest(table,{query='' }={}){return billingRows(`${table}?${query}`)},
      async rpc(){return{}}
    },
    DEBORA_APP_CONFIG:{API_BASE_URL:'https://example.test',CLIENT_RUNTIME_KEY:'test-key'}
  };
  context.window=context;
  context.globalThis=context;
  vm.runInNewContext(billingSource,context,{filename:'billing-v2.js'});

  await Promise.all([
    context.DeboraBilling.remountPlan(),
    context.DeboraBilling.remountPlan(),
    context.DeboraBilling.remountPlan()
  ]);

  assert.equal(hosts.length,1,'concurrent plan mounts must collapse to one patient plan host');
  assert.equal(hosts[0]?.dataset?.motherId,'mother-1');
});
