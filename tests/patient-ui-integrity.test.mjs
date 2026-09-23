import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const guardSource=readFileSync('public/package-card-singleton-guard.js','utf8');
const loaderSource=readFileSync('public/phase68-loader.js','utf8');
const routeGuardSource=readFileSync('public/p0-route-guard.js','utf8');
const serviceWorkerSource=readFileSync('public/sw.js','utf8');

function host(motherId){
  return {
    dataset:{motherId},
    isConnected:true,
    removed:false,
    remove(){this.removed=true;this.isConnected=false;}
  };
}

test('package singleton guard collapses duplicate hosts across the document',()=>{
  const a=host('mother-1'),b=host('mother-1'),c=host('mother-1');
  const hosts=[a,b,c];
  const screen={hidden:false,contains(node){return hosts.includes(node)}};
  const document={
    querySelectorAll(selector){
      if(selector==='[data-bv-patient-plan]')return hosts.filter(node=>node.isConnected);
      if(selector==='[data-screen="patient"]')return [screen];
      return [];
    }
  };
  const context={
    document,
    location:{hash:'#/patient/mother-1'},
    MutationObserver:class{observe(){}},
    queueMicrotask(fn){fn();},
    addEventListener(){},
    console
  };
  context.window=context;
  context.globalThis=context;
  vm.runInNewContext(guardSource,context,{filename:'package-card-singleton-guard.js'});
  context.DeboraPackageCardGuard.collapse();
  assert.equal(hosts.filter(node=>node.isConnected).length,1);
  assert.equal(hosts.filter(node=>node.isConnected)[0].dataset.motherId,'mother-1');
});

test('package singleton guard starts independently of phase 6-8 feature readiness',()=>{
  const guardImport=loaderSource.indexOf("import './package-card-singleton-guard.js'");
  const dependencyGate=loaderSource.indexOf('!window.DeboraDocuments');
  assert.ok(guardImport>=0,'singleton guard import missing');
  assert.ok(dependencyGate>=0,'phase dependency gate missing');
  assert.ok(guardImport<dependencyGate,'singleton guard must start before unrelated phase dependencies');
  assert.match(guardSource,/\.observe\(document,/);
});

test('patient route guard preserves weight card for migrated or non-UUID patient ids',()=>{
  const weightCard={removed:false,remove(){this.removed=true}};
  const context={
    document:{
      querySelectorAll(selector){
        if(selector.includes('[data-weight-changes-v4]'))return [weightCard];
        return [];
      }
    },
    location:{hash:'#/patient/migrated-patient-9'},
    MutationObserver:class{observe(){}},
    setTimeout(){return 1},
    clearTimeout(){},
    addEventListener(){},
    console
  };
  context.window=context;
  context.globalThis=context;
  const executable=routeGuardSource.replace(/^import .*?;\s*/,'');
  vm.runInNewContext(executable,context,{filename:'p0-route-guard.js'});
  assert.equal(weightCard.removed,false,'valid patient route must not lose the weight evolution card');
});

test('patient route guard still clears patient-only weight UI after leaving the patient route',()=>{
  const weightCard={removed:false,remove(){this.removed=true}};
  const listeners={};
  const context={
    document:{
      querySelectorAll(selector){
        if(selector.includes('[data-weight-changes-v4]'))return [weightCard];
        return [];
      }
    },
    location:{hash:'#/patients'},
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
  assert.match(serviceWorkerSource,/1\.14\.0-cloudflare-native/);
  for(const asset of ['billing-v2.js','phase68-loader.js','package-card-singleton-guard.js','p0-route-guard.js','weight-evolution-v5.js','weight-evolution-v5.css']){
    assert.ok(serviceWorkerSource.includes(asset),`missing ${asset} from service worker shell`);
  }
});
