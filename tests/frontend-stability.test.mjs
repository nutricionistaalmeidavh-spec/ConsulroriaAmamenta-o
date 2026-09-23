import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/clinical-source/core/app-shell.js',import.meta.url),'utf8');
test('initial load cannot expose editable UI before completing data and route initialization',()=>{
  const start=source.slice(source.indexOf('async function startApp()'),source.indexOf("loginForm?.addEventListener('submit'"));
  assert.ok(start.indexOf('showLoggedIn()') > start.indexOf('await renderRoute()'));
});
test('patient form uses atomic create/edit, a retained idempotency key and a submit lock',()=>{
  const submit=source.slice(source.indexOf("patientForm?.addEventListener('submit'"),source.indexOf("patientForm?.addEventListener('submit'")+2300);
  assert.match(submit,/if \(patientSaveBusy\) return/);
  assert.match(submit,/'Idempotency-Key': patientSaveAttempt.key/);
  assert.match(submit,/method: editingPatientId \? 'PATCH' : 'POST'/);
  assert.doesNotMatch(submit,/appData.updatePatient|appData.saveConsents/);
});
