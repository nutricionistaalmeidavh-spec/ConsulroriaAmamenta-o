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
function requestKey(input){return String(input?.p_request_key||'').trim()}
function recordId(entry){return String(entry?.record?.id||entry?.key||'')}
async function ownedRecord(env,table,id,userId){return(await tableRows(env,table)).find(entry=>recordId(entry)===String(id)&&owned(entry,userId))||null}
async function ownedAppointment(env,id,userId){return ownedRecord(env,'appointments',id,userId)}
async function ownedPackage(env,id,userId){return ownedRecord(env,'care_packages',id,userId)}
async function runAtomic(env,statements){
  const database=db(env);
  if(typeof database.batch==='function')return database.batch(statements);
  const out=[];for(const statement of statements)out.push(await statement.run());return out;
}

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
  const key=requestKey(input);
  if(!packageId)return runtimeJson(400,{message:'Plano obrigatório.'});
  if(!key)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  const entry=await ownedPackage(env,packageId,user.id);
  if(!entry)return runtimeJson(404,{message:'Plano não encontrado ou sem permissão.'});

  const sessions=(await tableRows(env,'care_package_sessions')).filter(session=>owned(session,user.id));
  const existing=sessions.find(session=>String(session.record?.request_key||'')===key&&String(session.record?.package_id||session.record?.care_package_id||'')===packageId);
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
    appointment_id:null,encounter_id:null,source:'manual',request_key:key,notes:String(input?.p_notes||''),
    consumed_at:now,used_at:now,created_at:now,updated_at:now
  };
  const sessionEntry={key:session.id,ownerId:user.id,record:session};
  await runAtomic(env,[
    saveStatement(env,'care_package_sessions',sessionEntry,session),
    saveStatement(env,'care_packages',entry,nextPackage)
  ]);
  return runtimeJson(200,packagePayload(nextPackage,{idempotent:false}));
}

async function addPackageItemV2(env,user,input){
  const packageId=String(input?.p_package_id||'').trim();
  const key=requestKey(input);
  const label=String(input?.p_label||'').trim();
  const itemType=String(input?.p_item_type||'service').trim()||'service';
  const quantity=Math.trunc(Number(input?.p_quantity_total??1));
  const pricingMode=String(input?.p_pricing_mode||'included').trim();
  const unitPrice=Math.max(0,Math.trunc(Number(input?.p_unit_price_cents||0))||0);
  const explicitAmount=Math.max(0,Math.trunc(Number(input?.p_amount_cents||0))||0);
  const amount=explicitAmount||unitPrice*quantity;
  if(!packageId)return runtimeJson(400,{message:'Plano obrigatório.'});
  if(!key)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  if(!label)return runtimeJson(400,{message:'Informe o serviço.'});
  if(!Number.isInteger(quantity)||quantity<=0)return runtimeJson(400,{message:'Quantidade inválida.'});
  if(!['service','consultation','other'].includes(itemType))return runtimeJson(400,{message:'Categoria inválida.'});
  if(!['included','additional'].includes(pricingMode))return runtimeJson(400,{message:'Forma de cobrança inválida.'});

  const packageEntry=await ownedPackage(env,packageId,user.id);
  if(!packageEntry||packageEntry.record?.status==='cancelled')return runtimeJson(404,{message:'Plano não encontrado, cancelado ou sem permissão.'});
  const existingByKey=(await tableRows(env,'care_package_items')).find(entry=>String(entry.record?.request_key||'')===key||String(entry.key)===key);
  if(existingByKey){
    if(!owned(existingByKey,user.id)||String(existingByKey.record?.package_id||'')!==packageId)return runtimeJson(409,{message:'Identificador da operação já utilizado.',error:'request_key_conflict'});
    const currentPackage=(await ownedPackage(env,packageId,user.id))?.record||packageEntry.record;
    return runtimeJson(200,{item:existingByKey.record,package_id:packageId,package_total_cents:Number(currentPackage.total_cents||0),pricing_mode:existingByKey.record.pricing_mode,idempotent:true});
  }

  const now=new Date().toISOString();
  const item={
    id:key,owner_id:user.id,package_id:packageId,mother_id:packageEntry.record.mother_id||null,
    catalog_item_id:input?.p_catalog_item_id||null,label,item_type:itemType,category:itemType,
    quantity_total:quantity,quantity_used:0,pricing_mode:pricingMode,unit_price_cents:unitPrice,
    amount_cents:amount,notes:String(input?.p_notes||''),status:'active',request_key:key,created_at:now,updated_at:now
  };
  const itemEntry={key,ownerId:user.id,record:item};
  let nextPackage={...packageEntry.record,status:'active',updated_at:now};
  const statements=[saveStatement(env,'care_package_items',itemEntry,item)];

  if(pricingMode==='additional'&&amount>0){
    nextPackage={...nextPackage,total_cents:Number(packageEntry.record.total_cents||0)+amount};
    const linkedId=String(packageEntry.record.financial_entry_id||'');
    const linked=linkedId?await ownedRecord(env,'financial_entries',linkedId,user.id):null;
    if(linked&&String(linked.record?.status||'')==='Pendente'){
      const financial={...linked.record,amount_cents:nextPackage.total_cents,description:`Plano/Pacote · ${packageEntry.record.service_label||'Plano'}`,package_id:packageId,updated_at:now};
      statements.push(saveStatement(env,'financial_entries',linked,financial));
    }else{
      const financialId=key;
      const collision=(await tableRows(env,'financial_entries')).find(entry=>String(entry.key)===financialId);
      if(collision&&!owned(collision,user.id))return runtimeJson(409,{message:'Identificador da operação já utilizado.',error:'request_key_conflict'});
      const financial={
        id:financialId,owner_id:user.id,mother_id:item.mother_id,package_id:packageId,package_item_id:item.id,
        description:`Adicional do plano · ${label}`,amount_cents:amount,status:'Pendente',due_at:now.slice(0,10),
        request_key:key,created_at:now,updated_at:now
      };
      statements.push(saveStatement(env,'financial_entries',{key:financialId,ownerId:user.id,record:financial},financial));
    }
  }
  statements.push(saveStatement(env,'care_packages',packageEntry,nextPackage));
  await runAtomic(env,statements);
  return runtimeJson(200,{item,package_id:packageId,package_total_cents:Number(nextPackage.total_cents||0),pricing_mode:pricingMode,idempotent:false});
}

async function consumePackageItemV2(env,user,input){
  const itemId=String(input?.p_item_id||'').trim();
  const key=requestKey(input);
  if(!itemId)return runtimeJson(400,{message:'Item obrigatório.'});
  if(!key)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  const itemEntry=await ownedRecord(env,'care_package_items',itemId,user.id);
  if(!itemEntry||itemEntry.record?.status==='cancelled')return runtimeJson(404,{message:'Item não encontrado, cancelado ou sem permissão.'});
  const item=itemEntry.record;
  const packageEntry=await ownedPackage(env,item.package_id,user.id);
  if(!packageEntry||packageEntry.record?.status==='cancelled')return runtimeJson(404,{message:'Plano não encontrado, cancelado ou sem permissão.'});

  const usages=await tableRows(env,'care_package_item_usages');
  const sameKey=usages.find(entry=>String(entry.record?.request_key||'')===key||String(entry.key)===key);
  if(sameKey){
    if(!owned(sameKey,user.id)||String(sameKey.record?.package_item_id||'')!==itemId)return runtimeJson(409,{message:'Identificador da operação já utilizado.',error:'request_key_conflict'});
    const current=await ownedRecord(env,'care_package_items',itemId,user.id);
    return runtimeJson(200,{item:current?.record||item,usage_id:sameKey.record.id||sameKey.key,package_id:item.package_id,idempotent:true});
  }
  if(Number(item.quantity_used||0)>=Number(item.quantity_total||0))return runtimeJson(409,{message:'Todas as utilizações deste serviço já foram consumidas.'});

  const appointmentId=input?.p_appointment_id?String(input.p_appointment_id):'';
  if(appointmentId){
    const appointment=await ownedAppointment(env,appointmentId,user.id);
    if(!appointment||String(appointment.record?.mother_id||'')!==String(item.mother_id||''))return runtimeJson(409,{message:'Agendamento incompatível com este plano.'});
  }
  const encounterId=input?.p_encounter_id?String(input.p_encounter_id):'';
  if(encounterId){
    const encounter=await ownedRecord(env,'clinical_encounters',encounterId,user.id);
    if(!encounter||String(encounter.record?.mother_id||'')!==String(item.mother_id||''))return runtimeJson(409,{message:'Prontuário incompatível com este plano.'});
  }

  const now=new Date().toISOString();
  const used=Math.min(Number(item.quantity_total||0),Number(item.quantity_used||0)+1);
  const nextItem={...item,quantity_used:used,status:used>=Number(item.quantity_total||0)?'completed':'active',updated_at:now};
  const usage={
    id:key,owner_id:user.id,package_id:item.package_id,package_item_id:itemId,mother_id:item.mother_id||null,
    appointment_id:appointmentId||null,encounter_id:encounterId||null,notes:String(input?.p_notes||''),request_key:key,
    consumed_at:now,used_at:now,created_at:now,updated_at:now
  };
  const allItems=(await tableRows(env,'care_package_items')).filter(entry=>owned(entry,user.id)&&String(entry.record?.package_id||'')===String(item.package_id));
  const openItems=allItems.some(entry=>{
    const candidate=recordId(entry)===itemId?nextItem:entry.record;
    return candidate?.status!=='cancelled'&&Number(candidate?.quantity_used||0)<Number(candidate?.quantity_total||0);
  });
  const pkg=packageEntry.record;
  const nextPackage={...pkg,status:remaining(pkg)<=0&&!openItems?'completed':'active',updated_at:now};
  await runAtomic(env,[
    saveStatement(env,'care_package_item_usages',{key,ownerId:user.id,record:usage},usage),
    saveStatement(env,'care_package_items',itemEntry,nextItem),
    saveStatement(env,'care_packages',packageEntry,nextPackage)
  ]);
  return runtimeJson(200,{item:nextItem,usage_id:key,package_id:item.package_id,idempotent:false});
}

export async function handlePackageLifecycleRuntime(request,env,url=new URL(request.url)){
  if(!env.CLINICAL_DB||request.method!=='POST'||!url.pathname.startsWith('/rest/v1/rpc/'))return null;
  const name=decodeURIComponent(url.pathname.slice('/rest/v1/rpc/'.length));
  if(!['set_appointment_billing','consume_care_package_session_manual','add_care_package_item_v2','consume_care_package_item_v2'].includes(name))return null;
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id)return runtimeJson(401,{message:'Sessão expirada. Entre novamente.'});
  const input=await request.clone().json().catch(()=>({}));
  if(name==='consume_care_package_session_manual')return consumeManualPackageSession(request,env,user,input);
  if(name==='add_care_package_item_v2')return addPackageItemV2(env,user,input);
  if(name==='consume_care_package_item_v2')return consumePackageItemV2(env,user,input);
  if(input?.p_billing_mode!=='package_new')return null;
  return reconcileBeforeNewPackage(request,env,user,input);
}
