import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=()=>readFileSync('public/billing-v2.js','utf8');

test('patient package card mount is single-flight and collapses duplicate hosts',()=>{
  const src=source();
  assert.match(src,/createSingleFlight/);
  assert.match(src,/bvPlanFlight/);
  assert.match(src,/screen\.querySelectorAll\('\[data-bv-patient-plan\]'\)/);
  assert.match(src,/duplicates?\.forEach|hosts\.slice\(1\)\.forEach|forEach\([^)]*=>[^;]*\.remove\(\)/s);
});

test('patient package mount revalidates patient context after async package load',()=>{
  const src=source();
  assert.match(src,/bvPatientMotherId\(\)!==mid/);
  assert.match(src,/screen\.isConnected/);
});
