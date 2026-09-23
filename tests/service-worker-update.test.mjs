import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
test('SW activation removes only obsolete app caches; private data and stale bundles are never recovered from old caches',async()=>{
  const handlers={},deleted=[],puts=[],network=[];
  const current='debora-lactacao-v1.14.2-cache-reset';
  const caches={async keys(){return ['debora-lactacao-vold',current,'unrelated'];},async delete(k){deleted.push(k);},async open(k){assert.equal(k,current);return {async match(){return undefined;},async put(...args){puts.push(args);}};}};
  vm.runInNewContext(readFileSync('public/sw.js','utf8'),{URL,Request,Response,caches,self:{location:{origin:'https://app.test'},clients:{async claim(){}},addEventListener(n,fn){handlers[n]=fn;},skipWaiting(){}},fetch:async r=>{network.push(r);throw new Error('offline');}});
  let waiting;handlers.activate({waitUntil(p){waiting=p;}});await waiting;
  assert.deepEqual(deleted,['debora-lactacao-vold']);
  let response;
  handlers.fetch({request:new Request('https://app.test/config.js'),respondWith(p){response=p;}});
  assert.equal((await response).type,'error');assert.equal(network.at(-1).cache,'no-store');
  handlers.fetch({request:new Request('https://app.test/api/auth/recovery'),respondWith(p){response=p;}});
  await assert.rejects(response,/offline/);assert.equal(puts.length,0);
});
