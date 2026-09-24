import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-clinical-runtime.js';
import { handleAtomicPackageIntegrityRuntime } from './package-integrity-atomic-runtime.js';

const MANUAL_PATH='/api/clinical/rpc/consume_care_package_session_manual';
const FINALIZE_PATH='/api/clinical/rpc/finalize_encounter_billing';
const CLAIM_PATH='$.__package_session_claim';

function requireDb(env){if(!env.CLINICAL_DB)throw new Error('clinical_db_not_configured');return env.CLINICAL_DB}
function parseEntry(row){if(!row)return null;try{return{key:row.record_key,ownerId:row.owner_id||null,record:JSON.parse(row.record_json)}}catch{return null}}
function remaining(pkg){return Math.max(0,Number(pkg?.sessions_total||0)-Number(pkg?.sessions_used||0))}
function changes(result){const value=result?.meta?.changes;return Number.isFinite(Number(value))?Number(value):null}
function packagePayload(pkg,{idempotent=false,billingMode=null}={}){return{handled:true,idempotent,...(billingMode?{billing_mode:billingMode}:{}),package_id:pkg.id,sessions_total:Number(pkg.sessions_total||0),sessions_used:Number(pkg.sessions_used||0),sessions_remaining:remaining(pkg),package_status:pkg.status||'active'}}

async function ownedRecord(database,table,id,ownerId){
  if(!id)return null;
  return parseEntry(await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name=? AND owner_id=? AND (record_key=? OR json_extract(record_json,'$.id')=?) LIMIT 1`)
    .bind(table,ownerId,id,id).first());
}
async function ownedPackage(database,id,ownerId){return ownedRecord(database,'care_packages',id,ownerId)}
async function sessionByRequestKey(database,ownerId,packageId,requestKey){
  return parseEntry(await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name='care_package_sessions' AND owner_id=? AND json_extract(record_json,'$.request_key')=?
      AND COALESCE(json_extract(record_json,'$.package_id'),json_extract(record_json,'$.care_package_id'))=? LIMIT 1`)
    .bind(ownerId,requestKey,packageId).first());
}
async function sessionByEncounter(database,ownerId,packageId,encounterId){
  if(!encounterId)return null;
  return parseEntry(await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name='care_package_sessions' AND owner_id=? AND json_extract(record_json,'$.encounter_id')=?
      AND COALESCE(json_extract(record_json,'$.package_id'),json_extract(record_json,'$.care_package_id'))=? LIMIT 1`)
    .bind(ownerId,encounterId,packageId).first());
}
async function sessionByAppointment(database,ownerId,packageId,appointmentId){
  return parseEntry(await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name='care_package_sessions' AND owner_id=? AND json_extract(record_json,'$.appointment_id')=?
      AND COALESCE(json_extract(record_json,'$.package_id'),json_extract(record_json,'$.care_package_id'))=? LIMIT 1`)
    .bind(ownerId,appointmentId,packageId).first());
}

function packageClaimStatement(database,{packageKey,ownerId,expectedUsed,claimKey,sessionKey,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,
      '$.sessions_used',CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)+1,
      '$.status',CASE WHEN CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)+1>=CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER) THEN 'completed' ELSE 'active' END,
      '$.updated_at',?,'${CLAIM_PATH}',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=?
      AND COALESCE(json_extract(record_json,'$.status'),'active')='active'
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)=?
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)<CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)
      AND NOT EXISTS(SELECT 1 FROM supabase_records s WHERE s.table_name='care_package_sessions' AND s.record_key=? AND s.owner_id=?)`)
    .bind(now,claimKey,now,now,packageKey,ownerId,expectedUsed,sessionKey,ownerId);
}
function sessionInsertStatement(database,{sessionKey,ownerId,packageKey,claimKey,recordJson,now}){
  return database.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    SELECT 'care_package_sessions',?,?,?,?,?,? WHERE EXISTS(
      SELECT 1 FROM supabase_records WHERE table_name='care_packages' AND record_key=? AND owner_id=? AND json_extract(record_json,'${CLAIM_PATH}')=?)`)
    .bind(sessionKey,ownerId,recordJson,now,now,now,packageKey,ownerId,claimKey);
}
function packageClaimCleanupStatement(database,{packageKey,ownerId,claimKey,now}){
  return database.prepare(`UPDATE supabase_records SET record_json=json_remove(record_json,'${CLAIM_PATH}'),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=? AND json_extract(record_json,'${CLAIM_PATH}')=?`)
    .bind(now,now,packageKey,ownerId,claimKey);
}

async function claimPackageSession({database,ownerId,packageId,sessionKey,findExisting,buildSession}){
  for(let attempt=0;attempt<6;attempt+=1){
    const replayBefore=await findExisting();
    if(replayBefore){const pkg=(await ownedPackage(database,packageId,ownerId))?.record;return pkg?{kind:'replay',pkg}:{kind:'missing'}}
    const entry=await ownedPackage(database,packageId,ownerId);
    if(!entry)return{kind:'missing'};
    if(entry.record?.status!=='active'||remaining(entry.record)<=0)return{kind:'exhausted',pkg:entry.record};
    const now=new Date().toISOString(),expectedUsed=Number(entry.record.sessions_used||0),claimKey=`${sessionKey}:${crypto.randomUUID()}`;
    const session=buildSession({pkg:entry.record,now});
    let results;
    try{
      results=await database.batch([
        packageClaimStatement(database,{packageKey:entry.key,ownerId,expectedUsed,claimKey,sessionKey,now}),
        sessionInsertStatement(database,{sessionKey,ownerId,packageKey:entry.key,claimKey,recordJson:JSON.stringify(session),now}),
        packageClaimCleanupStatement(database,{packageKey:entry.key,ownerId,claimKey,now}),
      ]);
    }catch(error){
      const replay=await findExisting();
      if(replay){const pkg=(await ownedPackage(database,packageId,ownerId))?.record;return pkg?{kind:'replay',pkg}:{kind:'missing'}}
      throw error;
    }
    const claimChanges=changes(results?.[0]),insertChanges=changes(results?.[1]);
    const [replayAfter,current]=await Promise.all([findExisting(),ownedPackage(database,packageId,ownerId)]);
    if(!current)return{kind:'missing'};
    if(claimChanges===1&&replayAfter&&(insertChanges===1||insertChanges===null))return{kind:'consumed',pkg:current.record};
    if(replayAfter)return{kind:'replay',pkg:current.record};
    if(current.record?.status==='active'&&remaining(current.record)>0&&Number(current.record.sessions_used||0)!==expectedUsed)continue;
    return{kind:'exhausted',pkg:current.record};
  }
  return{kind:'conflict'};
}
function responseForClaim(result,{billingMode=null}={}){
  if(result.kind==='consumed')return runtimeJson(200,packagePayload(result.pkg,{idempotent:false,billingMode}));
  if(result.kind==='replay')return runtimeJson(200,packagePayload(result.pkg,{idempotent:true,billingMode}));
  if(result.kind==='missing')return runtimeJson(404,{message:'Plano não encontrado ou sem permissão.'});
  if(result.kind==='conflict')return runtimeJson(409,{message:'Plano alterado por outra operação. Tente novamente.',error:'package_concurrency_conflict'});
  return runtimeJson(409,{message:'Plano sem consultas disponíveis.'});
}

async function handleManual(request,env,user){
  const input=await request.clone().json().catch(()=>({}));
  const packageId=String(input?.p_package_id||'').trim(),requestKey=String(input?.p_request_key||'').trim();
  if(!packageId)return runtimeJson(400,{message:'Plano obrigatório.'});
  if(!requestKey)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  const database=requireDb(env),entry=await ownedPackage(database,packageId,user.id);
  if(!entry)return runtimeJson(404,{message:'Plano não encontrado ou sem permissão.'});
  const sessionKey=`manual:${packageId}:${requestKey}`;
  try{
    return responseForClaim(await claimPackageSession({database,ownerId:user.id,packageId,sessionKey,
      findExisting:()=>sessionByRequestKey(database,user.id,packageId,requestKey),
      buildSession:({pkg,now})=>({id:sessionKey,owner_id:user.id,package_id:pkg.id||packageId,care_package_id:pkg.id||packageId,mother_id:pkg.mother_id||null,appointment_id:null,encounter_id:null,source:'manual',request_key:requestKey,notes:String(input?.p_notes||''),consumed_at:now,used_at:now,created_at:now,updated_at:now})}));
  }catch(error){console.error('atomic package session consumption failed',error);return runtimeJson(503,{message:'Não foi possível registrar a consulta do plano. Tente novamente.'})}
}

async function handleFinalize(request,env,user){
  const input=await request.clone().json().catch(()=>({}));
  const appointmentId=String(input?.p_appointment_id||'').trim(),encounterId=String(input?.p_encounter_id||'').trim();
  if(!appointmentId)return runtimeJson(400,{message:'Agendamento obrigatório.'});
  if(!encounterId)return runtimeJson(400,{message:'Atendimento obrigatório.'});
  const database=requireDb(env),appointment=await ownedRecord(database,'appointments',appointmentId,user.id);
  if(!appointment)return runtimeJson(404,{message:'Agendamento não encontrado.'});
  const mode=String(appointment.record?.billing_mode||'individual');
  if(mode!=='package_active'&&mode!=='package_new')return null;
  const packageId=String(appointment.record?.package_id||'').trim();
  if(!packageId)return runtimeJson(409,{message:'Plano ativo não encontrado.'});
  const [packageEntry,encounter]=await Promise.all([ownedPackage(database,packageId,user.id),ownedRecord(database,'clinical_encounters',encounterId,user.id)]);
  if(!packageEntry)return runtimeJson(409,{message:'Plano ativo não encontrado.'});
  if(!encounter||String(encounter.record?.appointment_id||'')!==appointmentId||String(encounter.record?.mother_id||'')!==String(appointment.record?.mother_id||''))return runtimeJson(409,{message:'Prontuário incompatível com este agendamento.'});
  const sessionKey=`encounter:${packageId}:${encounterId}`;
  try{
    const result=await claimPackageSession({database,ownerId:user.id,packageId,sessionKey,
      findExisting:()=>sessionByEncounter(database,user.id,packageId,encounterId),
      buildSession:({pkg,now})=>({id:sessionKey,owner_id:user.id,package_id:pkg.id||packageId,care_package_id:pkg.id||packageId,mother_id:pkg.mother_id||appointment.record?.mother_id||null,appointment_id:appointmentId,encounter_id:encounterId,source:'encounter_finalize',request_key:`finalize:${appointmentId}:${encounterId}`,consumed_at:now,used_at:now,created_at:now,updated_at:now})});
    if(result.kind==='missing')return runtimeJson(409,{message:'Plano ativo não encontrado.'});
    return responseForClaim(result,{billingMode:mode});
  }catch(error){console.error('atomic encounter package finalization failed',error);return runtimeJson(503,{message:'Não foi possível finalizar a cobrança do plano. Tente novamente.'})}
}

export async function handleAtomicPackageSessionRuntime(request,env,url=new URL(request.url)){
  if(!env.CLINICAL_DB||request.method!=='POST')return null;
  const integrity=await handleAtomicPackageIntegrityRuntime(request,env,url);
  if(integrity)return integrity;
  if(url.pathname!==MANUAL_PATH&&url.pathname!==FINALIZE_PATH)return null;
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id)return runtimeJson(401,{message:'Sessão expirada. Entre novamente.'});
  if(url.pathname===MANUAL_PATH)return handleManual(request,env,user);
  return handleFinalize(request,env,user);
}
