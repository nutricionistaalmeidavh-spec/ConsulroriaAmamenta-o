import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

const read=(path)=>readFileSync(path,'utf8');

test('/app installs EventBus before native bootstrap',()=>{
  const app=read('app/index.html');
  const eventBus=app.indexOf('/eventbus-runtime.js');
  const bootstrap=app.indexOf('/src/bootstrap.js');
  assert.doesNotMatch(app,/cloudflare-fetch-bridge/);
  assert.ok(eventBus>=0);
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

test('bootstrap explicitly re-arms clinical phase loaders after replacing the document',()=>{
  const bootstrap=read('src/bootstrap.js');
  const closeAt=bootstrap.indexOf('document.close();');
  const ensureAt=bootstrap.indexOf('await ensureClinicalPhaseLoaders();');
  assert.ok(closeAt>=0,'bootstrap must finish the canonical document replacement');
  assert.ok(ensureAt>closeAt,'phase loaders must be re-armed after document.close()');
  for(const [file,startName] of [
    ['public/phase02-loader.js','startPhase02'],
    ['public/phase35-loader.js','startPhase35'],
    ['public/phase68-loader.js','startPhase68'],
  ]){
    assert.match(read(file),new RegExp(`export async function ${startName}\\(`),`${file} must expose an idempotent restart entrypoint`);
    assert.match(bootstrap,new RegExp(`${startName}`),`bootstrap must invoke ${startName}`);
  }
});

test('bootstrap re-arms clinical care flow against the live document after canonical replacement',()=>{
  const bootstrap=read('src/bootstrap.js');
  const closeAt=bootstrap.indexOf('document.close();');
  const additiveAt=bootstrap.indexOf('await ensureClinicalAdditiveFeatures();');
  assert.ok(closeAt>=0,'bootstrap must replace the placeholder document');
  assert.ok(additiveAt>closeAt,'additive care features must bind only after document.close()');
  assert.match(bootstrap,/clinical-care-flow-feature\.js\?canonical-runtime=1/);
});

test('blob clinical shell rewrites patient care status import before execution',()=>{
  const bootstrap=read('src/bootstrap.js');
  const importUrlAt=bootstrap.indexOf("new URL('/patient-care-status-core.js', window.location.origin).href");
  const rewriteAt=bootstrap.indexOf("shell = shell.replace(\n    \"'../../patient-care-status-core.js'\"");
  const blobAt=bootstrap.indexOf('const shellUrl = moduleUrl(shell);');
  assert.ok(importUrlAt>=0,'bootstrap must derive a same-origin URL for patient-care-status-core.js');
  assert.ok(rewriteAt>=0,'bootstrap must rewrite the relative patient care import used by the canonical shell');
  assert.ok(blobAt>rewriteAt,'patient care import must be rewritten before the shell is converted to a blob module');
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