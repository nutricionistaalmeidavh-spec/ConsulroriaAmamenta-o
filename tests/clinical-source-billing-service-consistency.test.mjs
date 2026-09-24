import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  billingScopeMatches,
  shouldFollowBillingService,
} from '../public/billing-service-consistency.js';

test('billing service override is scoped to the same mother and appointment draft',()=>{
  const record={motherId:'mother-a',appointmentId:'appointment-a',serviceLabel:'Consulta inicial'};
  assert.equal(billingScopeMatches(record,{motherId:'mother-a',appointmentId:'appointment-a'}),true);
  assert.equal(billingScopeMatches(record,{motherId:'mother-b',appointmentId:'appointment-a'}),false);
  assert.equal(billingScopeMatches(record,{motherId:'mother-a',appointmentId:'appointment-b'}),false);
});

test('untouched billing follows appointment type before persistence and when the same patient changes appointment context',()=>{
  assert.equal(shouldFollowBillingService({appointmentId:'',previousAppointmentId:'',sameMotherContext:false,overridden:false}),true);
  assert.equal(shouldFollowBillingService({appointmentId:'appointment-a',previousAppointmentId:'',sameMotherContext:true,overridden:false}),true);
  assert.equal(shouldFollowBillingService({appointmentId:'appointment-b',previousAppointmentId:'appointment-a',sameMotherContext:true,overridden:false}),true);
  assert.equal(shouldFollowBillingService({appointmentId:'appointment-a',previousAppointmentId:'',sameMotherContext:false,overridden:false}),false);
  assert.equal(shouldFollowBillingService({appointmentId:'appointment-a',previousAppointmentId:'appointment-a',sameMotherContext:true,overridden:false}),false);
  assert.equal(shouldFollowBillingService({appointmentId:'',previousAppointmentId:'',sameMotherContext:true,overridden:true}),false);
  assert.equal(shouldFollowBillingService({appointmentId:'appointment-b',previousAppointmentId:'appointment-a',sameMotherContext:true,overridden:true}),false);
});

test('canonical bootstrap wires billing consistency only after the live clinical document exists',()=>{
  const bootstrap=readFileSync('src/bootstrap.js','utf8');
  const closeAt=bootstrap.indexOf('document.close();');
  const importAt=bootstrap.indexOf("importPublicModule('/billing-service-consistency.js')");
  assert.ok(closeAt>=0);
  assert.ok(importAt>=0,'billing consistency module must be wired into canonical bootstrap');
  const ensureAt=bootstrap.indexOf('await ensureClinicalAdditiveFeatures();');
  assert.ok(ensureAt>closeAt,'billing consistency startup must happen after document.close()');
});
