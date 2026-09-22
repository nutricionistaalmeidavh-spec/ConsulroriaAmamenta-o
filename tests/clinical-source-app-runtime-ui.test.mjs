import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const read=(path)=>readFileSync(path,'utf8');

test('/app installs Cloudflare bridge and EventBus before bootstrap so legacy growth reads stay on D1',()=>{
  const app=read('app/index.html');
  const bridge=app.indexOf('/src/cloudflare-fetch-bridge.js');
  const eventBus=app.indexOf('/eventbus-runtime.js');
  const bootstrap=app.indexOf('/src/bootstrap.js');
  assert.ok(bridge>=0);
  assert.ok(eventBus>bridge);
  assert.ok(bootstrap>eventBus);
  assert.match(read('src/bootstrap.js'),/growth-feature\.js/);
});

test('clinical phase loaders use root-safe styles from /app',()=>{
  const expectations={
    'public/phase02-loader.js':['/documents-feature.css'],
    'public/phase35-loader.js':['/album-feature.css','/referrals-feature.css'],
    'public/phase68-loader.js':['/record-export-feature.css','/patient-records-hub.css','/patient-workspace.css','/package-audit-feature.css'],
  };
  for(const [file,assets] of Object.entries(expectations)){
    const source=read(file);
    for(const asset of assets)assert.ok(source.includes(asset),`${file} must load ${asset}`);
  }
});

test('async album and referral mounts cancel stale renders and stay singleton',()=>{
  for(const [file,card] of [['public/album-feature.js','af'],['public/referrals-feature.js','rf']]){
    const source=read(file);
    assert.match(source,/mountRevision/);
    assert.match(source,/const revision=\+\+mountRevision/);
    assert.match(source,/if\(revision!==mountRevision\)return/);
    assert.ok(source.split(`document.querySelectorAll('[data-${card}-card]').forEach(x=>x.remove())`).length>=3,`${file} must remove stale/duplicate cards before and after async work`);
  }
});

test('changed clinical runtime modules remain valid JavaScript',()=>{
  for(const file of ['public/phase02-loader.js','public/phase35-loader.js','public/phase68-loader.js','public/album-feature.js','public/referrals-feature.js']){
    execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
  }
});
