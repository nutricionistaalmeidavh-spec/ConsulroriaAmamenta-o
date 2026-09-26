import test from 'node:test';
import assert from 'node:assert/strict';
import { transformDelivery4Billing } from '../scripts/harden-delivery4-package-billing.mjs';

const crlfSource = [
  'async function sample(){',
  '  await bvRpc(\'set_appointment_billing\',{',
  '    p_package_sessions_total:s.packageSessionsTotal,',
  '    p_package_id:s.packageId',
  '  });',
  '}',
  'function renderBilling(){',
  '  return ',
  '      \'<option value="individual">Atendimento individual</option>\'+',
  '      (packages.length?\'<option value="package_active">Usar plano ativo</option>\':\'<option value="package_new">Novo plano / pacote</option>\')+',
  '      \'\';',
  '}',
  "function bvSchedule(){clearTimeout(bvTimer);bvTimer=setTimeout(()=>{bvMount().catch(e=>console.warn('Billing v2 mount',e));bvMountPatientPlan().catch(e=>console.warn('Plan mount',e))},120)}",
].join('\r\n');

test('Delivery 4 billing hardening supports unmaterialized Windows CRLF checkouts', () => {
  const materialized = transformDelivery4Billing(crlfSource);

  assert.match(materialized, /p_request_key:s\.mode==='package_new'\?'package-new:'\+appointmentId:null/);
  assert.match(materialized, /!packages\.length\|\|selection\.mode==='package_new'/);
  assert.match(materialized, /function bvSchedule\(\)\{if\(bvTimer\)return;bvTimer=setTimeout\(\(\)=>\{bvTimer=null;/);
});
