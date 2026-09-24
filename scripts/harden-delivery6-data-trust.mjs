import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT=resolve(import.meta.dirname,'..');
const MODE=process.argv.includes('--write')?'write':'check';

function sha256(text){return createHash('sha256').update(Buffer.from(text,'utf8')).digest('hex')}
function target(path,transform){
  const full=resolve(ROOT,path),source=readFileSync(full,'utf8'),next=transform(source);
  if(MODE==='check'&&next!==source)throw new Error(`${path}: Delivery 6 ainda não materializado`);
  if(MODE==='write'&&next!==source)writeFileSync(full,next,'utf8');
  return next!==source;
}
function replaceLine(source,prefix,replacement,label){
  const lines=source.split('\n'),index=lines.findIndex(line=>line.startsWith(prefix));
  if(index<0){if(source.includes(replacement))return source;throw new Error(`${label}: linha esperada não encontrada`)}
  lines[index]=replacement;return lines.join('\n');
}
function replaceFunction(source,name,replacement,label){
  const start=source.indexOf(`async function ${name}(`);
  if(start<0){if(source.includes(replacement))return source;throw new Error(`${label}: função ausente`)}
  const nextFunction=source.indexOf('\nfunction ',start+1);
  const nextAsync=source.indexOf('\nasync function ',start+1);
  const candidates=[nextFunction,nextAsync].filter(index=>index>start);
  const end=candidates.length?Math.min(...candidates):source.length;
  return source.slice(0,start)+replacement+source.slice(end);
}

const runtimeHelpers=`function pfRuntimeClient(){return window.DeboraRuntimeClient||null}
async function pfRest(path,opt={}){const raw=String(path||''),q=raw.indexOf('?'),resource=q>=0?raw.slice(0,q):raw,query=q>=0?raw.slice(q+1):'',client=pfRuntimeClient();if(client?.rest){let body=opt.body;if(typeof body==='string'){try{body=JSON.parse(body)}catch{}}return client.rest(resource,{method:opt.method||'GET',query,body,headers:opt.headers||{}})}const r=await pfNativeFetch(PF_SB+'/api/clinical/records/'+raw,{...opt,headers:{apikey:PF_KEY,Authorization:'Bearer '+(pfToken()||''),'Content-Type':'application/json',...(opt.headers||{})}});if(!r.ok){let m='Erro '+r.status;try{const j=await r.json();m=j.message||j.error_description||j.error||m}catch{}throw new Error(m)}if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null}
async function pfRpc(name,body={}){const client=pfRuntimeClient();if(client?.rpc)return client.rpc(name,body);const r=await pfNativeFetch(PF_SB+'/api/clinical/rpc/'+encodeURIComponent(name),{method:'POST',headers:{apikey:PF_KEY,Authorization:'Bearer '+(pfToken()||''),'Content-Type':'application/json'},body:JSON.stringify(body||{})});if(!r.ok){let m='Erro '+r.status;try{const j=await r.json();m=j.message||j.error_description||j.error||m}catch{}throw new Error(m)}if(r.status===204)return null;const t=await r.text();return t?JSON.parse(t):null}`;

const deleteAppointment="async function pfDeleteAppointment(id){if(!id)return;if(!await pfConfirmPhrase('Excluir agendamento?','Remove somente este agendamento ainda não iniciado. Prontuários clínicos são preservados.','EXCLUIR'))return;try{await pfRpc('delete_scheduled_appointment',{p_appointment_id:id,p_confirmation:'EXCLUIR'});location.hash='#/agenda';pfToast('Agendamento excluído.')}catch(e){pfToast(e.message||'Não foi possível excluir o agendamento.','error')}}";
const encounterRows="async function pfEncounterRows(mid,babyId){const rows=await pfRest('clinical_encounters?mother_id=eq.'+encodeURIComponent(mid)+'&select=id,status,mother_id,baby_id,appointment_id,occurred_at,clinical_note,updated_at&order=occurred_at.desc&limit=50');if(!babyId)return rows||[];const links=await pfRest('clinical_encounter_babies?baby_id=eq.'+encodeURIComponent(babyId)+'&select=encounter_id'),allowed=new Set((links||[]).map(x=>x.encounter_id));return (rows||[]).filter(x=>allowed.has(x.id)||x.baby_id===babyId)}";
const mountRecord=`async function pfMountProntuario(m,force=false){const mid=pfPatientId();document.querySelectorAll('[data-pf-prontuario]').forEach(x=>{if(!mid||x.dataset.pfPatient!==mid)x.remove()});if(!mid)return;const babyId=pfActiveBabyId(),key=mid+'|'+babyId,main=document.querySelector('main')||document.querySelector('[data-screen]')||document.body;let card=main.querySelector('[data-pf-prontuario]');if(!force&&card?.dataset.pfKey===key&&['loading','loaded','error'].includes(card.dataset.pfState||''))return;if(card&&card.dataset.pfKey!==key){card.remove();card=null}if(!card){card=document.createElement('section');card.dataset.pfProntuario='1';card.className='pf-prontuario-card';const h=main.querySelector('.cn-history');h?h.before(card):main.appendChild(card)}card.dataset.pfPatient=mid;card.dataset.pfKey=key;card.dataset.pfState='loading';const heading='<div class="pf-prontuario-head"><div><small>REGISTRO CLÍNICO</small><strong>Prontuários'+(babyId?' do bebê selecionado':' da paciente')+'</strong><span>Abra sempre pelo identificador persistido do atendimento.</span></div></div>';card.innerHTML=heading+'<div class="pf-prontuario-list"><div class="pf-prontuario-empty">Carregando prontuários…</div></div>';let rows;try{rows=await pfEncounterRows(mid,babyId)}catch(error){if(mid!==pfPatientId()||key!==pfPatientId()+'|'+pfActiveBabyId())return;card.dataset.pfState='error';card.innerHTML=heading+'<div class="pf-prontuario-list"><div class="pf-prontuario-empty"><strong>Não foi possível carregar os prontuários.</strong><span>Tente novamente sem recarregar a ficha.</span><button type="button" class="ui-button" data-pf-prontuario-retry>Tentar novamente</button></div></div>';card.querySelector('[data-pf-prontuario-retry]')?.addEventListener('click',()=>pfMountProntuario(m,true).catch(e=>pfToast(e.message||'Não foi possível carregar os prontuários.','error')));return}if(mid!==pfPatientId()||key!==pfPatientId()+'|'+pfActiveBabyId())return;card.dataset.pfState='loaded';card.innerHTML=heading+'<div class="pf-prontuario-list">'+(rows.length?rows.map(x=>'<button type="button" data-pf-encounter="'+x.id+'"><div><strong>'+(x.status==='finalized'?'Atendimento finalizado':'Rascunho')+'</strong><small>'+new Date(x.occurred_at).toLocaleString('pt-BR')+'</small></div><span>encounter_id · '+x.id.slice(0,8)+'…</span><b>Abrir ›</b></button>').join(''):'<div class="pf-prontuario-empty">Nenhum prontuário para este recorte.</div>')+'</div>';card.querySelectorAll('[data-pf-encounter]').forEach(btn=>btn.onclick=async()=>{const encounterId=btn.dataset.pfEncounter;if(!encounterId)return;try{const api=window.DeboraClinicalNote;if(!api?.openEncounter)throw new Error('Prontuário ainda está carregando.');await api.openEncounter(encounterId,{direction:'history'})}catch(e){pfToast(e.message||'Não foi possível abrir o prontuário.')}})}`;

const planHelpers=`function bvPlanLoadingMarkup(){return '<article class="detail-card bv-plan-card" aria-busy="true"><div class="section-heading"><div><span class="section-kicker">PLANO / PACOTE</span><h2>Carregando plano…</h2></div></div><p class="bv-plan-empty">Atualizando os dados desta paciente.</p></article>'}
function bvPlanErrorMarkup(){return '<article class="detail-card bv-plan-card"><div class="section-heading"><div><span class="section-kicker">PLANO / PACOTE</span><h2>Plano indisponível</h2></div></div><p class="bv-plan-empty">Não foi possível carregar o plano desta paciente.</p><button type="button" class="ui-button" data-bv-plan-retry>Tentar novamente</button></article>'}`;
const mountPlan=`async function bvMountPatientPlan(force=false){
  const mid=bvPatientMotherId(),screen=document.querySelector('[data-screen="patient"]');if(!mid||!screen)return;
  const initialHosts=[...screen.querySelectorAll('[data-bv-patient-plan]')];
  let host=initialHosts.find(node=>node.dataset.motherId===mid)||initialHosts[0]||null;
  if(!force&&host?.dataset.motherId===mid&&['loading','loaded','error'].includes(host.dataset.state||'')){initialHosts.forEach(node=>{if(node!==host)node.remove()});return}
  initialHosts.forEach(node=>{if(node!==host)node.remove()});
  if(!host){const anchor=screen.querySelector('.baby-selector-wrap');if(!anchor)return;host=document.createElement('div');host.dataset.bvPatientPlan='';anchor.insertAdjacentElement('afterend',host)}
  host.dataset.motherId=mid;host.dataset.state='loading';host.innerHTML=bvPlanLoadingMarkup();
  const revision=++bvPatientPlanRevision;
  try{
    const bundle=await bvPatientPackage(mid);
    if(revision!==bvPatientPlanRevision||mid!==bvPatientMotherId())return;
    host.dataset.state='loaded';host.innerHTML=bvPlanMarkup(bundle);
  }catch(error){
    if(revision!==bvPatientPlanRevision||mid!==bvPatientMotherId())return;
    host.dataset.state='error';host.innerHTML=bvPlanErrorMarkup();
    host.querySelector('[data-bv-plan-retry]')?.addEventListener('click',()=>bvMountPatientPlan(true).catch(err=>bvToast(err.message||String(err),'error')));
  }
  window.DeboraPackageCardGuard?.collapse?.();
}`;

const changed=[];
if(target('public/clinical-source/features/patient-fixes.js',source=>{
  let next=source;
  if(!next.includes('function pfRuntimeClient()')){
    const old=next.split('\n').find(line=>line.startsWith('async function pfRest(path,opt={})'));
    if(!old)throw new Error('patient fixes: pfRest ausente');
    next=next.replace(old,runtimeHelpers);
  }
  next=replaceLine(next,'async function pfDeleteAppointment(id)',deleteAppointment,'appointment delete');
  next=replaceLine(next,'async function pfEncounterRows(mid,babyId)',encounterRows,'encounter rows');
  next=replaceFunction(next,'pfMountProntuario',mountRecord,'prontuário mount');
  next=next.replace('Remove este agendamento e o prontuário clínico vinculado.','Remove somente este agendamento ainda não iniciado. Prontuários clínicos são preservados.');
  if(next.includes('rpc/delete_appointment'))throw new Error('appointment delete: RPC legado ainda ativo');
  if(next.includes("pfRest('clinical_encounters?")&&next.match(/async function pfEncounterRows[^\n]*catch\(\(\)=>\[\]\)/))throw new Error('prontuário: erro ainda convertido em vazio');
  if(!next.includes('DeboraRuntimeClient')||!next.includes('data-pf-prontuario-retry'))throw new Error('prontuário: contrato de erro/retry ausente');
  return next;
}))changed.push('patient-records');

if(target('public/billing-v2.js',source=>{
  let next=source;
  if(!next.includes('function bvPlanLoadingMarkup()'))next=next.replace('async function bvMountPatientPlan(force=false){',planHelpers+'\nasync function bvMountPatientPlan(force=false){');
  next=replaceFunction(next,'bvMountPatientPlan',mountPlan,'patient plan mount');
  if(!next.includes("host.dataset.motherId=mid;host.dataset.state='loading';host.innerHTML=bvPlanLoadingMarkup();"))throw new Error('patient plan: identidade não invalidada antes da leitura');
  if(!next.includes('data-bv-plan-retry'))throw new Error('patient plan: retry ausente');
  return next;
}))changed.push('patient-plan');

const manifestPath=resolve(ROOT,'public/clinical-source/manifest.json');
const patientPath=resolve(ROOT,'public/clinical-source/features/patient-fixes.js');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const entry=manifest?.modules?.['features/patient-fixes.js'];
if(!entry)throw new Error('clinical manifest: patient-fixes ausente');
const hash=sha256(readFileSync(patientPath,'utf8'));
if(entry.sha256!==hash){
  if(MODE==='check')throw new Error('clinical manifest: hash patient-fixes desatualizado');
  entry.sha256=hash;
  if(!String(entry.source||'').includes('+delivery6-data-trust'))entry.source=`${entry.source||'patient-fixes'}+delivery6-data-trust`;
  writeFileSync(manifestPath,`${JSON.stringify(manifest,null,2)}\n`,'utf8');changed.push('clinical-manifest');
}

console.log(`Delivery 6 data trust ${MODE}: ${changed.length?changed.join(', '):'already hardened'}`);