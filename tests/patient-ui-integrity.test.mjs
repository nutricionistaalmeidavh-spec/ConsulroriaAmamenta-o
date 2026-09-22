import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const routeGuardSource=readFileSync(new URL('../public/p0-route-guard.js',import.meta.url),'utf8');
const serviceWorkerSource=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

test('patient route guard preserves weight card for migrated or non-UUID patient ids',()=>{
  const weightCard={removed:false,remove(){this.removed=true}};
  const body={dataset:{},querySelectorAll(selector){return selector==='[data-weight-evolution-card]'?[weightCard]:[]}};
  const listeners={};
  const context={
    location:{hash:'#/patient/9bf-migrated-patient-id'},
    document:{body,querySelectorAll:body.querySelectorAll.bind(body)},
    MutationObserver:class{observe(){}},
    setTimeout(fn){fn();return 1},
    clearTimeout(){},
    addEventListener(type,fn){listeners[type]=fn},
    console
  };
  context.window=context;
  context.globalThis=context;
  const executable=routeGuardSource.replace(/^import .*?;\s*/,'');
  vm.runInNewContext(executable,context,{filename:'p0-route-guard.js'});
  assert.equal(weightCard.removed,false,'weight card must survive a valid patient route even when id is not a UUID');
});

test('patient route guard still clears patient-only weight UI after leaving the patient route',()=>{
  const weightCard={removed:false,remove(){this.removed=true}};
  const body={dataset:{},querySelectorAll(selector){return selector==='[data-weight-evolution-card]'?[weightCard]:[]}};
  const listeners={};
  const context={
    location:{hash:'#/dashboard'},
    document:{body,querySelectorAll:body.querySelectorAll.bind(body)},
    MutationObserver:class{observe(){}},
    setTimeout(fn){fn();return 1},
    clearTimeout(){},
    addEventListener(type,fn){listeners[type]=fn},
    console
  };
  context.window=context;
  context.globalThis=context;
  const executable=routeGuardSource.replace(/^import .*?;\s*/,'');
  vm.runInNewContext(executable,context,{filename:'p0-route-guard.js'});
  assert.equal(weightCard.removed,true,'weight card must be cleaned up after leaving patient routes');
});

test('new service worker cache revision includes patient UI integrity assets',()=>{
  assert.match(serviceWorkerSource,/1\.14\.0-cloudflare-only/);
  for(const asset of ['billing-v2.js','phase68-loader.js','package-card-singleton-guard.js','p0-route-guard.js','weight-evolution-v5.js','weight-evolution-v5.css']){
    assert.ok(serviceWorkerSource.includes(asset),`missing ${asset} from service worker shell`);
  }
});
