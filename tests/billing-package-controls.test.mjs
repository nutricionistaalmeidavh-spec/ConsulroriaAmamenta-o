import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const billing=readFileSync('public/billing-v2.js','utf8');
const migrationPath='supabase/phase-package-session-controls.sql';

function functionBody(name){
  const start=billing.indexOf(`async function ${name}`);
  assert.notEqual(start,-1,`${name} must exist`);
  const next=billing.indexOf('\nasync function ',start+1);
  return billing.slice(start,next===-1?billing.length:next);
}

test('billing preserves the professional package selection before binding the appointment',()=>{
  const body=functionBody('bvBeforeStart');
  assert.match(body,/data-billing-v2/);
  assert.match(body,/dataset\.motherId/);
  assert.match(body,/if\([^\n]*host[^\n]*\)[\s\S]*?await bvMount\(true\)/);
  assert.match(body,/return bvValidate\(bvSelection\(\)\)/);
  assert.doesNotMatch(body,/async function bvBeforeStart\(mid\)\{\s*await bvMount\(true\)/);
});

test('package finalization validates the same package that was selected',()=>{
  const body=functionBody('bvFinalize');
  assert.match(billing,/function bvAssertPackageFinalized/);
  assert.match(body,/bvReadDraft\(\)/);
  assert.match(body,/bvAssertPackageFinalized\(expected,result\)/);
  assert.match(body,/finalize_encounter_billing/);
});

test('patient package exposes manual consultation completion through a protected RPC',()=>{
  assert.match(billing,/data-bv-use-session/);
  assert.match(billing,/async function bvUsePackageSession/);
  assert.match(billing,/consume_care_package_session_manual/);
  assert.match(billing,/p_request_key:requestKey/);
});

test('manual package session migration is explicit, idempotent and keeps source provenance',()=>{
  assert.equal(existsSync(migrationPath),true,`${migrationPath} must exist`);
  const sql=readFileSync(migrationPath,'utf8');
  assert.match(sql,/alter column encounter_id drop not null/i);
  assert.match(sql,/add column if not exists source/i);
  assert.match(sql,/add column if not exists request_key/i);
  assert.match(sql,/create unique index if not exists[^;]*request_key/is);
  assert.match(sql,/create or replace function public\.consume_care_package_session_manual/i);
  assert.match(sql,/auth\.uid\(\)/i);
  assert.match(sql,/for update/i);
  assert.match(sql,/sessions_used/i);
  assert.match(sql,/source[^\n]*manual/i);
  assert.match(sql,/revoke all on function public\.consume_care_package_session_manual/i);
  assert.match(sql,/grant execute on function public\.consume_care_package_session_manual/i);
});
