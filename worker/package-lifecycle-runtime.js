import {authenticateClinicalRequest} from './cloudflare-auth-runtime.js';
import {runtimeJson} from './cloudflare-clinical-runtime.js';

function db(env){if(!env.CLINICAL_DB)throw new Error('clinical_db_not_configured');return env.CLINICAL_DB}
async function tableRows(env,table){
  const result=await db(env).prepare('SELECT record_key,owner_id,record_json FROM supabase_records WHERE table_name = ?').bind(table).all();
  return(result.results||[]).map(row=>{try{return{key:row.record_key,ownerId:row.owner_id||null,record:JSON.parse(row.record_json)}}catch{return null}}).filter(Boolean);
}
function owned(entry,userId){return Boolean(entry)&&(String(entry.ownerId||entry.record?.owner_id||'')===String(userId));}
function saveStatement(env,table,entry,row){
  const now=new Date().toISOString();
  const next={...row,updated_at:row.updated_at||now};
  return db(env).prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO UPDATE SET
    owner_id=excluded.owner_id,record_json=excluded.record_json,source_created_at=excluded.source_created_at,
    source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`).bind(
      table,entry.key,entry.ownerId||next.owner_id||null,JSON.stringify(next),next.created_at||now,next.updated_at||now,now
    );
}
async function saveEntry(env,table,entry,row){await saveStatement(env,table,entry,row).run();return row}
function remaining(pkg){return Math.max(0,Number(pkg.sessions_total||0)-Number(pkg.sessions_used||0))}
function packagePayload(pkg,{idempotent=false}={}){
  return{
    handled:true,
    idempotent,
    package_id:pkg.id,
    sessions_total:Number(pkg.sessions_total||0),
    sessions_used:Number(pkg.sessions_used||0),
    sessions_remaining:remaining(pkg),
    package_status:pkg.status||'active'
  };
}
async function ownedAppointment(env,id,userId){return(await tableRows(env,'appointments')).find(entry=>String(entry.record?.id||entry.key)===String(id)&&owned(entry,userId))||null}
async function ownedPackage(env,id,userId){return(await tableRows(env,'care_packages')).find(entry=>String(entry.record?.id||entry.key)===String(id)&&owned(entry,userId))||null}

async function reconcileBeforeNewPackage(request,env,user,input){
  const appointment=await ownedAppointment(env,input.p_appointment_id,user.id);
  if(!appointment)return null;
  const motherId=appointment.record.mother_id;
  const packageEntries=(await tableRows(env,'care_packages')).filter(entry=>owned(entry,user.id)&&String(entry.record?.mother_id||'')===String(motherId)&&entry.record?.status==='active');
  let blocking=null;
  for(const entry of packageEntries){
    const pkg=entry.record;
    if(remaining(pkg)<=0){
      await saveEntry(env,'care_packages',entry,{...pkg,status:'completed',updated_at:new Date().toISOString()});
    }else if(!blocking){blocking=pkg;}
  }
  if(blocking)return runtimeJson(409,{message:'Esta paciente já possui um plano ativo com consultas disponíveis.',package_id:blocking.id,sessions_remaining:remaining(blocking)});
  return null;
}

async function consumeManualPackageSession(request,env,user,input){
  const packageId=String(input?.p_package_id||'');
  const requestKey=String(input?.p_request_key||'');
  if(!packageId)return runtimeJson(400,{message:'Plano obrigatório.'});
  if(!requestKey)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  const entry=await ownedPackage(env,packageId,user.id);
  if(!entry)return runtimeJson(404,{message:'Plano não encontrado ou sem permissão.'});

  const sessions=(await tableRows(env,'care_package_sessions')).filter(session=>owned(session,user.id));
  const existing=sessions.find(session=>String(session.record?.request_key||'')===requestKey&&String(session.record?.package_id||session.record?.care_package_id||'')===packageId);
  if(existing)return runtimeJson(200,packagePayload(entry.record,{idempotent:true}));

  const pkg=entry.record;
  if(pkg.status!=='active'||remaining(pkg)<=0){
    if(pkg.status==='active'&&remaining(pkg)<=0)await saveEntry(env,'care_packages',entry,{...pkg,status:'completed',updated_at:new Date().toISOString()});
    return runtimeJson(409,{message:'Plano sem consultas disponíveis.'});
  }

  const now=new Date().toISOString();
  const used=Math.min(Number(pkg.sessions_total||0),Number(pkg.sessions_used||0)+1);
  const nextPackage={...pkg,sessions_used:used,status:used>=Number(pkg.sessions_total||0)?'completed':'active',updated_at:now};
  const session={
    id:crypto.randomUUID(),owner_id:user.id,package_id:pkg.id,care_package_id:pkg.id,mother_id:pkg.mother_id||null,
    appointment_id:null,encounter_id:null,source:'manual',request_key:requestKey,notes:String(input?.p_notes||''),
    consumed_at:now,used_at:now,created_at:now,updated_at:now
  };
  const sessionEntry={key:session.id,ownerId:user.id,record:session};
  const database=db(env);
  if(typeof database.batch==='function')await database.batch([
    saveStatement(env,'care_package_sessions',sessionEntry,session),
    saveStatement(env,'care_packages',entry,nextPackage)
  ]);
  else{
    await saveEntry(env,'care_package_sessions',sessionEntry,session);
    await saveEntry(env,'care_packages',entry,nextPackage);
  }
  return runtimeJson(200,packagePayload(nextPackage,{idempotent:false}));
}

export async function handlePackageLifecycleRuntime(request,env,url=new URL(request.url)){
  if(!env.CLINICAL_DB||request.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/'))return null;
  const name=decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
  if(!['set_appointment_billing','consume_care_package_session_manual'].includes(name))return null;
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id)return runtimeJson(401,{message:'Sessão expirada. Entre novamente.'});
  const input=await request.clone().json().catch(()=>({}));
  if(name==='consume_care_package_session_manual')return consumeManualPackageSession(request,env,user,input);
  if(input?.p_billing_mode!=='package_new')return null;
  return reconcileBeforeNewPackage(request,env,user,input);
}
