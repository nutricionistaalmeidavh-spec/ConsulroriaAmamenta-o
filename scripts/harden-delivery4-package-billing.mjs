import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT=resolve(import.meta.dirname,'..');
const BILLING_PATH=resolve(ROOT,'public/billing-v2.js');
const MODE=process.argv.includes('--write')?'write':'check';

export function transformDelivery4Billing(source){
  const text=String(source);
  if(text.includes("p_request_key:s.mode==='package_new'?'package-new:'+appointmentId:null"))return text;
  const needle="    p_package_sessions_total:s.packageSessionsTotal,\n    p_package_id:s.packageId\n";
  const replacement="    p_package_sessions_total:s.packageSessionsTotal,\n    p_package_id:s.packageId,\n    p_request_key:s.mode==='package_new'?'package-new:'+appointmentId:null\n";
  if(!text.includes(needle))throw new Error('delivery 4 billing bind target not found');
  return text.replace(needle,replacement);
}

export function runDelivery4BillingHardening(){
  const source=readFileSync(BILLING_PATH,'utf8');
  const next=transformDelivery4Billing(source);
  const marker="p_request_key:s.mode==='package_new'?'package-new:'+appointmentId:null";
  if(!next.includes(marker))throw new Error('delivery 4 stable package-new request key missing');
  if(MODE==='check'&&next!==source)throw new Error('delivery 4 package billing hardening ainda não materializado');
  if(MODE==='write'&&next!==source)writeFileSync(BILLING_PATH,next,'utf8');
  console.log(`Delivery 4 package billing ${MODE}: ${next===source?'already hardened':'updated'}`);
  return next;
}

const direct=process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href;
if(direct)runDelivery4BillingHardening();
