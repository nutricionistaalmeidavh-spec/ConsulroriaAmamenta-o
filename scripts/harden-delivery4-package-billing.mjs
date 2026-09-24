import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT=resolve(import.meta.dirname,'..');
const BILLING_PATH=resolve(ROOT,'public/billing-v2.js');
const MODE=process.argv.includes('--write')?'write':'check';
const REQUEST_KEY_MARKER="p_request_key:s.mode==='package_new'?'package-new:'+appointmentId:null";
const PACKAGE_NEW_REMOUNT_MARKER="!packages.length||selection.mode==='package_new'";
const GUARANTEED_SCHEDULE_MARKER='function bvSchedule(){if(bvTimer)return;bvTimer=setTimeout(()=>{bvTimer=null;';

export function transformDelivery4Billing(source){
  let next=String(source);
  if(!next.includes(REQUEST_KEY_MARKER)){
    const needle="    p_package_sessions_total:s.packageSessionsTotal,\n    p_package_id:s.packageId\n";
    const replacement="    p_package_sessions_total:s.packageSessionsTotal,\n    p_package_id:s.packageId,\n    p_request_key:s.mode==='package_new'?'package-new:'+appointmentId:null\n";
    if(!next.includes(needle))throw new Error('delivery 4 billing bind target not found');
    next=next.replace(needle,replacement);
  }
  if(!next.includes(PACKAGE_NEW_REMOUNT_MARKER)){
    const oldOptions=`      '<option value="individual">Atendimento individual</option>'+\n      (packages.length?'<option value="package_active">Usar plano ativo</option>':'<option value="package_new">Novo plano / pacote</option>')+\n`;
    const newOptions=`      '<option value="individual">Atendimento individual</option>'+\n      (packages.length?'<option value="package_active">Usar plano ativo</option>':'')+\n      (!packages.length||selection.mode==='package_new'?'<option value="package_new">Novo plano / pacote</option>':'')+\n`;
    if(!next.includes(oldOptions))throw new Error('delivery 4 package-new remount target not found');
    next=next.replace(oldOptions,newOptions);
  }
  if(!next.includes(GUARANTEED_SCHEDULE_MARKER)){
    const oldSchedule="function bvSchedule(){clearTimeout(bvTimer);bvTimer=setTimeout(()=>{bvMount().catch(e=>console.warn('Billing v2 mount',e));bvMountPatientPlan().catch(e=>console.warn('Plan mount',e))},120)}";
    const newSchedule="function bvSchedule(){if(bvTimer)return;bvTimer=setTimeout(()=>{bvTimer=null;bvMount().catch(e=>console.warn('Billing v2 mount',e));bvMountPatientPlan().catch(e=>console.warn('Plan mount',e))},120)}";
    if(!next.includes(oldSchedule))throw new Error('delivery 12 billing scheduler target not found');
    next=next.replace(oldSchedule,newSchedule);
  }
  if(!/bvSchedule\(\);\s*$/.test(next))next=next.replace(/\s*$/,'\nbvSchedule();\n');
  return next;
}

export function runDelivery4BillingHardening(){
  const source=readFileSync(BILLING_PATH,'utf8');
  const next=transformDelivery4Billing(source);
  if(!next.includes(REQUEST_KEY_MARKER))throw new Error('delivery 4 stable package-new request key missing');
  if(!next.includes(PACKAGE_NEW_REMOUNT_MARKER))throw new Error('delivery 4 package-new remount preservation missing');
  if(!next.includes(GUARANTEED_SCHEDULE_MARKER))throw new Error('delivery 12 billing scheduler can still be starved by DOM mutations');
  if(!/bvSchedule\(\);\s*$/.test(next))throw new Error('delivery 4 initial billing mount schedule missing');
  if(MODE==='check'&&next!==source)throw new Error('delivery 4 package billing hardening ainda não materializado');
  if(MODE==='write'&&next!==source)writeFileSync(BILLING_PATH,next,'utf8');
  console.log(`Delivery 4 package billing ${MODE}: ${next===source?'already hardened':'updated'}`);
  return next;
}

const direct=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(direct)runDelivery4BillingHardening();
