import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

test('package singleton guard exists and collapses duplicate patient package hosts',()=>{
  assert.equal(existsSync('public/package-card-singleton-guard.js'),true);
  const src=readFileSync('public/package-card-singleton-guard.js','utf8');
  assert.match(src,/querySelectorAll\('\[data-bv-patient-plan\]'\)/);
  assert.match(src,/\.remove\(\)/);
  assert.match(src,/MutationObserver/);
});

test('phase68 loader starts singleton guard before package audit decoration',()=>{
  const loader=readFileSync('public/phase68-loader.js','utf8');
  const guard=loader.indexOf("package-card-singleton-guard.js");
  const audit=loader.indexOf("package-audit-feature.js");
  assert.ok(guard>=0,'singleton guard missing from loader');
  assert.ok(audit>=0,'package audit feature missing from loader');
  assert.ok(guard<audit,'singleton guard must load before package audit feature');
});
