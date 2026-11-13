import test from 'node:test';
import assert from 'node:assert/strict';
import {reportingDay, resolvePeriod, createPeriodReport, serializeFinanceCsv} from '../public/finance-monthly-report.js';

test('period resolves complete October and arbitrary date ranges in clinic time', () => {
  assert.deepEqual(resolvePeriod({month:'2026-10'}), {from:'2026-10-01',to:'2026-10-31',label:'Outubro de 2026'});
  assert.deepEqual(resolvePeriod({from:'2026-09-29',to:'2026-10-02'}), {from:'2026-09-29',to:'2026-10-02',label:'29/09/2026 a 02/10/2026'});
  assert.throws(() => resolvePeriod({from:'2026-02-30',to:'2026-03-01'}), /data inválida/i);
  assert.throws(() => resolvePeriod({from:'2026-11-02',to:'2026-11-01'}), /início/i);
  assert.equal(reportingDay('2026-10-01'), '2026-10-01', 'date-only cannot slip into September at UTC-3');
  assert.equal(reportingDay('2026-11-01T01:00:00Z'), '2026-10-31');
});

test('month report separates payment date, due date, finalized encounters, unique patients and returns', () => {
  const fixture={
    patients:[{mother:{id:'m1',name:'Mãe A',created_at:'2026-10-03T14:00:00Z'}},{mother:{id:'m2',name:'Mãe B',created_at:'2026-09-01T14:00:00Z'}}],
    appointments:[{id:'a1',appointment_type:'Consulta'},{id:'a2',appointment_type:'Retorno'},{id:'a3',appointment_type:'Consulta',billing_mode:'package_active'}],
    encounters:[{id:'e1',mother_id:'m1',appointment_id:'a1',occurred_at:'2026-10-03T14:00:00Z',status:'finalized'},{id:'e2',mother_id:'m1',appointment_id:'a2',occurred_at:'2026-10-10T14:00:00Z',status:'finalized'},{id:'e3',mother_id:'m2',appointment_id:'a3',occurred_at:'2026-10-29T14:00:00Z',status:'finalized'},{id:'e4',mother_id:'m1',occurred_at:'2026-10-30',status:'draft'}],
    financial:[
      {id:'f1',mother_id:'m1',encounter_id:'e1',status:'Pago',amount_cents:12000,paid_at:'2026-11-02T14:00:00Z',due_at:'2026-10-03'},
      {id:'f2',mother_id:'m1',status:'Pago',amount_cents:8000,paid_at:'2026-10-31T14:00:00Z'},
      {id:'f3',mother_id:'m2',status:'Pendente',amount_cents:5000,due_at:'2026-10-16'},
      {id:'f4',mother_id:'m2',status:'Cancelado',amount_cents:9900,due_at:'2026-10-16'},
      {id:'f5',mother_id:'m1',status:'Pago',amount_cents:3000,paid_at:null,created_at:'2026-10-05T12:00:00Z'}
    ]
  };
  const report=createPeriodReport(fixture,resolvePeriod({month:'2026-10'}));
  assert.equal(report.receivedCents,8000);
  assert.equal(report.paymentCount,1);
  assert.equal(report.pendingCents,5000);
  assert.equal(report.pendingCount,1);
  assert.equal(report.averagePaymentCents,8000);
  assert.equal(report.finalizedCount,3);
  assert.equal(report.patientCount,2);
  assert.equal(report.newPatientCount,1);
  assert.equal(report.returnCount,1);
  assert.equal(report.unlinkedCount,1, 'package appointment is not a missing individual charge');
  assert.equal(report.missingPaymentDateCount,1);
  assert.deepEqual(report.rows.map(f=>f.id),['f2','f3']);
  assert.equal(createPeriodReport(fixture,resolvePeriod({month:'2026-11'})).receivedCents,12000);
});

test('CSV sanitizes spreadsheet formulas and exports the same period rows', () => {
 const rows=[{id:'a',patient_name:'=HYPERLINK("evil")',description:'+1+1',status:'Pago',amount_cents:2000,paid_at:'2026-10-12T15:00:00Z'}];
 const csv=serializeFinanceCsv(rows);
 assert.ok(csv.startsWith('\uFEFF'));
 assert.match(csv,/"'=HYPERLINK\(""evil""\)"/);
 assert.match(csv,/"'\+1\+1"/);
 assert.match(csv,/20,00/);
});
