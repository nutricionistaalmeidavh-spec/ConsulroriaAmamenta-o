import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-clinical-runtime.js';

const SET_BILLING_PATH='/api/clinical/rpc/set_appointment_billing';
const ADD_ITEM_PATH='/api/clinical/rpc/add_care_package_item_v2';
const CONSUME_ITEM_PATH='/api/clinical/rpc/consume_care_package_item_v2';
const ITEM_CLAIM_PATH='$.__package_item_claim';

function requireDb(env){if(!env.CLINICAL_DB)throw new Error('clinical_db_not_configured');return env.CLINICAL_DB}
function parseEntry(row){if(!row)return null;try{return{key:row.record_key,ownerId:row.owner_id||null,record:JSON.parse(row.record_json)}}catch{return null}}
function changes(result){const value=result?.meta?.changes;return Number.isFinite(Number(value))?Number(value):null}
function remaining(pkg){return Math.max(0,Number(pkg?.sessions_total||0)-Number(pkg?.sessions_used||0))}

async function ownedRecord(database,table,id,ownerId){
  if(!id)return null;
  return parseEntry(await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name=? AND owner_id=? AND (record_key=? OR json_extract(record_json,'$.id')=?) LIMIT 1`)
    .bind(table,ownerId,id,id).first());
}
async function ownedPackage(database,id,ownerId){return ownedRecord(database,'care_packages',id,ownerId)}
async function stableUuid(seed){
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(seed))));
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const hex=[...bytes.slice(0,16)].map(value=>value.toString(16).padStart(2,'0')).join('');
  return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}
function insertDoNothing(database,table,key,ownerId,record,now){
  return database.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(table_name,record_key) DO NOTHING`)
    .bind(table,key,ownerId,JSON.stringify(record),record.created_at||now,record.updated_at||now,now);
}
function appointmentBillingStatement(database,{appointmentKey,ownerId,input,packageId,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,
      '$.billing_mode','package_new',
      '$.service_label',?,
      '$.value_cents',?,
      '$.payment_method',?,
      '$.package_total_cents',?,
      '$.package_sessions_total',?,
      '$.package_id',?,
      '$.updated_at',?),
    source_updated_at=?,migrated_at=?
    WHERE table_name='appointments' AND record_key=? AND owner_id=?`)
    .bind(String(input.p_service_label||'Plano'),Number(input.p_value_cents??input.p_package_total_cents??0),String(input.p_payment_method||''),
      Number(input.p_package_total_cents||0),Number(input.p_package_sessions_total||0),packageId,now,now,now,appointmentKey,ownerId);
}
function packageFinancialLinkStatement(database,{packageKey,ownerId,financialId,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,'$.financial_entry_id',?,'$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=?`)
    .bind(financialId,now,now,now,packageKey,ownerId);
}
async function activePackages(database,ownerId,motherId){
  const result=await database.prepare(`SELECT record_key,owner_id,record_json FROM supabase_records
    WHERE table_name='care_packages' AND owner_id=?
      AND json_extract(record_json,'$.mother_id')=?
      AND COALESCE(json_extract(record_json,'$.status'),'active')='active'`)
    .bind(ownerId,motherId).all();
  return(result.results||[]).map(parseEntry).filter(Boolean);
}
async function healExhaustedPackages(database,ownerId,motherId,now){
  await database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,'$.status','completed','$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND owner_id=?
      AND json_extract(record_json,'$.mother_id')=?
      AND COALESCE(json_extract(record_json,'$.status'),'active')='active'
      AND CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)
        >= CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)`)
    .bind(now,now,now,ownerId,motherId).run();
}

async function setPackageBilling(database,user,input){
  if(String(input?.p_billing_mode||'')!=='package_new')return null;
  const appointmentId=String(input?.p_appointment_id||'').trim();
  if(!appointmentId)return runtimeJson(400,{message:'Agendamento obrigatório.'});
  const appointment=await ownedRecord(database,'appointments',appointmentId,user.id);
  if(!appointment)return runtimeJson(404,{message:'Agendamento não encontrado.'});
  const motherId=String(appointment.record?.mother_id||'').trim();
  if(!motherId)return runtimeJson(409,{message:'Paciente do agendamento não encontrada.'});
  const total=Math.trunc(Number(input?.p_package_total_cents||0));
  const sessions=Math.trunc(Number(input?.p_package_sessions_total||0));
  if(!(total>0)||!(sessions>0))return runtimeJson(400,{message:'Valor total e quantidade de sessões do plano são obrigatórios.'});
  const operationKey=String(input?.p_request_key||`package-new:${appointmentId}`).trim();

  const alreadyId=String(appointment.record?.package_id||'').trim();
  if(String(appointment.record?.billing_mode||'')==='package_new'&&alreadyId){
    const already=await ownedPackage(database,alreadyId,user.id);
    if(already)return runtimeJson(200,{...appointment.record,idempotent:true});
  }

  const packageId=await stableUuid(`package:${user.id}:${appointmentId}:${operationKey}`);
  const financialId=await stableUuid(`package-financial:${user.id}:${packageId}`);
  const samePackage=await ownedPackage(database,packageId,user.id);
  if(samePackage){
    const now=new Date().toISOString();
    await database.batch([
      appointmentBillingStatement(database,{appointmentKey:appointment.key,ownerId:user.id,input,packageId,now}),
      packageFinancialLinkStatement(database,{packageKey:samePackage.key,ownerId:user.id,financialId,now}),
    ]);
    const updated=await ownedRecord(database,'appointments',appointmentId,user.id);
    return runtimeJson(200,{...(updated?.record||appointment.record),idempotent:true});
  }

  const now=new Date().toISOString();
  await healExhaustedPackages(database,user.id,motherId,now);
  const blocking=(await activePackages(database,user.id,motherId)).find(entry=>String(entry.record?.id||entry.key)!==packageId&&remaining(entry.record)>0);
  if(blocking)return runtimeJson(409,{message:'Esta paciente já possui um plano ativo com consultas disponíveis.',package_id:blocking.record.id||blocking.key,sessions_remaining:remaining(blocking.record)});

  const pkg={
    id:packageId,owner_id:user.id,mother_id:motherId,service_label:String(input?.p_service_label||'Plano'),total_cents:total,
    sessions_total:sessions,sessions_used:0,status:'active',payment_method:String(input?.p_payment_method||''),
    financial_entry_id:financialId,source_appointment_id:appointmentId,request_key:operationKey,created_at:now,updated_at:now
  };
  const financial={
    id:financialId,owner_id:user.id,mother_id:motherId,appointment_id:appointmentId,package_id:packageId,package_item_id:null,
    description:`Plano/Pacote · ${pkg.service_label}`,amount_cents:total,status:'Pendente',paid:false,
    payment_method:String(input?.p_payment_method||''),due_at:String(appointment.record?.starts_at||now).slice(0,10),
    request_key:operationKey,created_at:now,updated_at:now
  };
  await database.batch([
    insertDoNothing(database,'care_packages',packageId,user.id,pkg,now),
    insertDoNothing(database,'financial_entries',financialId,user.id,financial,now),
    appointmentBillingStatement(database,{appointmentKey:appointment.key,ownerId:user.id,input,packageId,now}),
  ]);
  const [savedPackage,updated]=await Promise.all([
    ownedPackage(database,packageId,user.id),ownedRecord(database,'appointments',appointmentId,user.id)
  ]);
  if(!savedPackage)return runtimeJson(409,{message:'Identificador do plano já utilizado.',error:'request_key_conflict'});
  return runtimeJson(200,{...(updated?.record||appointment.record),idempotent:false});
}

function packageTotalIncrementStatement(database,{packageKey,ownerId,itemKey,amount,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,
      '$.total_cents',CAST(COALESCE(json_extract(record_json,'$.total_cents'),0) AS INTEGER)+?,
      '$.status','active','$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=?
      AND COALESCE(json_extract(record_json,'$.status'),'active')<>'cancelled'
      AND EXISTS(SELECT 1 FROM supabase_records i WHERE i.table_name='care_package_items' AND i.record_key=? AND i.owner_id=?
        AND CAST(COALESCE(json_extract(i.record_json,'$.__package_total_applied'),0) AS INTEGER)=0)`)
    .bind(amount,now,now,now,packageKey,ownerId,itemKey,ownerId);
}
function activatePackageForItemStatement(database,{packageKey,ownerId,now}){
  return database.prepare(`UPDATE supabase_records SET record_json=json_set(record_json,'$.status','active','$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=? AND COALESCE(json_extract(record_json,'$.status'),'active')<>'cancelled'`)
    .bind(now,now,now,packageKey,ownerId);
}
function syncLinkedFinancialStatement(database,{financialKey,packageKey,ownerId,itemKey,description,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,
      '$.amount_cents',(SELECT CAST(COALESCE(json_extract(p.record_json,'$.total_cents'),0) AS INTEGER) FROM supabase_records p
        WHERE p.table_name='care_packages' AND p.record_key=? AND p.owner_id=? LIMIT 1),
      '$.description',?,'$.package_id',?,'$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='financial_entries' AND record_key=? AND owner_id=? AND json_extract(record_json,'$.status')='Pendente'
      AND EXISTS(SELECT 1 FROM supabase_records i WHERE i.table_name='care_package_items' AND i.record_key=? AND i.owner_id=?
        AND CAST(COALESCE(json_extract(i.record_json,'$.__package_total_applied'),0) AS INTEGER)=0)`)
    .bind(packageKey,ownerId,description,packageKey,now,now,now,financialKey,ownerId,itemKey,ownerId);
}
function markItemTotalAppliedStatement(database,{itemKey,ownerId,now}){
  return database.prepare(`UPDATE supabase_records SET record_json=json_set(record_json,'$.__package_total_applied',1,'$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_package_items' AND record_key=? AND owner_id=?`)
    .bind(now,now,now,itemKey,ownerId);
}
async function addPackageItem(database,user,input){
  const packageId=String(input?.p_package_id||'').trim(),key=String(input?.p_request_key||'').trim(),label=String(input?.p_label||'').trim();
  const quantity=Math.trunc(Number(input?.p_quantity_total??input?.p_quantity??1));
  const pricingMode=String(input?.p_pricing_mode||'included').trim();
  const itemType=String(input?.p_item_type||input?.p_category||'service').trim()||'service';
  const amount=Math.max(0,Math.trunc(Number(input?.p_amount_cents||0))||Math.max(0,Math.trunc(Number(input?.p_unit_price_cents||0)))*quantity);
  if(!packageId)return runtimeJson(400,{message:'Plano obrigatório.'});
  if(!key)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  if(!label)return runtimeJson(400,{message:'Informe o serviço.'});
  if(!(quantity>0))return runtimeJson(400,{message:'Quantidade inválida.'});
  if(!['included','additional'].includes(pricingMode))return runtimeJson(400,{message:'Forma de cobrança inválida.'});
  const pkg=await ownedPackage(database,packageId,user.id);
  if(!pkg||pkg.record?.status==='cancelled')return runtimeJson(404,{message:'Plano não encontrado, cancelado ou sem permissão.'});
  const existing=await ownedRecord(database,'care_package_items',key,user.id);
  if(existing){
    if(String(existing.record?.package_id||'')!==packageId)return runtimeJson(409,{message:'Identificador da operação já utilizado.',error:'request_key_conflict'});
    const current=await ownedPackage(database,packageId,user.id);
    return runtimeJson(200,{item:existing.record,package_id:packageId,package_total_cents:Number(current?.record?.total_cents||0),pricing_mode:existing.record.pricing_mode,idempotent:true});
  }
  const now=new Date().toISOString();
  const item={
    id:key,owner_id:user.id,package_id:packageId,mother_id:pkg.record.mother_id||null,catalog_item_id:input?.p_catalog_item_id||null,
    label,item_type:itemType,category:itemType,quantity_total:quantity,quantity_used:0,pricing_mode:pricingMode,
    unit_price_cents:Math.max(0,Math.trunc(Number(input?.p_unit_price_cents||0))||0),amount_cents:amount,
    notes:String(input?.p_notes||''),status:'active',request_key:key,__package_total_applied:pricingMode==='additional'&&amount>0?0:1,
    created_at:now,updated_at:now
  };
  const statements=[insertDoNothing(database,'care_package_items',key,user.id,item,now),activatePackageForItemStatement(database,{packageKey:pkg.key,ownerId:user.id,now})];
  if(pricingMode==='additional'&&amount>0){
    statements.push(packageTotalIncrementStatement(database,{packageKey:pkg.key,ownerId:user.id,itemKey:key,amount,now}));
    const linkedId=String(pkg.record?.financial_entry_id||'').trim();
    const linked=linkedId?await ownedRecord(database,'financial_entries',linkedId,user.id):null;
    if(linked&&String(linked.record?.status||'')==='Pendente'){
      statements.push(syncLinkedFinancialStatement(database,{financialKey:linked.key,packageKey:pkg.key,ownerId:user.id,itemKey:key,description:`Plano/Pacote · ${pkg.record.service_label||'Plano'}`,now}));
    }else{
      const financialId=await stableUuid(`package-item-financial:${user.id}:${packageId}:${key}`);
      const financial={id:financialId,owner_id:user.id,mother_id:item.mother_id,package_id:packageId,package_item_id:key,description:`Adicional do plano · ${label}`,amount_cents:amount,status:'Pendente',paid:false,due_at:now.slice(0,10),request_key:key,created_at:now,updated_at:now};
      statements.push(insertDoNothing(database,'financial_entries',financialId,user.id,financial,now));
    }
    statements.push(markItemTotalAppliedStatement(database,{itemKey:key,ownerId:user.id,now}));
  }
  const results=await database.batch(statements);
  const [saved,current]=await Promise.all([ownedRecord(database,'care_package_items',key,user.id),ownedPackage(database,packageId,user.id)]);
  if(!saved)return runtimeJson(409,{message:'Não foi possível adicionar o serviço ao plano.',error:'package_item_conflict'});
  return runtimeJson(200,{item:saved.record,package_id:packageId,package_total_cents:Number(current?.record?.total_cents||0),pricing_mode:pricingMode,idempotent:changes(results?.[0])===0});
}

function itemClaimStatement(database,{itemKey,ownerId,expectedUsed,claimKey,usageKey,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,
      '$.quantity_used',CAST(COALESCE(json_extract(record_json,'$.quantity_used'),0) AS INTEGER)+1,
      '$.status',CASE WHEN CAST(COALESCE(json_extract(record_json,'$.quantity_used'),0) AS INTEGER)+1>=CAST(COALESCE(json_extract(record_json,'$.quantity_total'),0) AS INTEGER) THEN 'completed' ELSE 'active' END,
      '$.updated_at',?,'${ITEM_CLAIM_PATH}',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_package_items' AND record_key=? AND owner_id=?
      AND CAST(COALESCE(json_extract(record_json,'$.quantity_used'),0) AS INTEGER)=?
      AND CAST(COALESCE(json_extract(record_json,'$.quantity_used'),0) AS INTEGER)<CAST(COALESCE(json_extract(record_json,'$.quantity_total'),0) AS INTEGER)
      AND COALESCE(json_extract(record_json,'$.status'),'active')<>'cancelled'
      AND NOT EXISTS(SELECT 1 FROM supabase_records u WHERE u.table_name='care_package_item_usages' AND u.record_key=? AND u.owner_id=?)`)
    .bind(now,claimKey,now,now,itemKey,ownerId,expectedUsed,usageKey,ownerId);
}
function usageInsertStatement(database,{usageKey,ownerId,itemKey,claimKey,recordJson,now}){
  return database.prepare(`INSERT INTO supabase_records(table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at)
    SELECT 'care_package_item_usages',?,?,?,?,?,? WHERE EXISTS(
      SELECT 1 FROM supabase_records WHERE table_name='care_package_items' AND record_key=? AND owner_id=? AND json_extract(record_json,'${ITEM_CLAIM_PATH}')=?)`)
    .bind(usageKey,ownerId,recordJson,now,now,now,itemKey,ownerId,claimKey);
}
function itemClaimCleanupStatement(database,{itemKey,ownerId,claimKey,now}){
  return database.prepare(`UPDATE supabase_records SET record_json=json_remove(record_json,'${ITEM_CLAIM_PATH}'),source_updated_at=?,migrated_at=?
    WHERE table_name='care_package_items' AND record_key=? AND owner_id=? AND json_extract(record_json,'${ITEM_CLAIM_PATH}')=?`)
    .bind(now,now,itemKey,ownerId,claimKey);
}
function packageStatusAfterUsageStatement(database,{packageKey,packageId,ownerId,usageKey,now}){
  return database.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,'$.status',CASE
      WHEN CAST(COALESCE(json_extract(record_json,'$.sessions_used'),0) AS INTEGER)>=CAST(COALESCE(json_extract(record_json,'$.sessions_total'),0) AS INTEGER)
       AND NOT EXISTS(SELECT 1 FROM supabase_records i WHERE i.table_name='care_package_items' AND i.owner_id=?
         AND json_extract(i.record_json,'$.package_id')=? AND COALESCE(json_extract(i.record_json,'$.status'),'active')<>'cancelled'
         AND CAST(COALESCE(json_extract(i.record_json,'$.quantity_used'),0) AS INTEGER)<CAST(COALESCE(json_extract(i.record_json,'$.quantity_total'),0) AS INTEGER))
      THEN 'completed' ELSE 'active' END,'$.updated_at',?),source_updated_at=?,migrated_at=?
    WHERE table_name='care_packages' AND record_key=? AND owner_id=?
      AND EXISTS(SELECT 1 FROM supabase_records u WHERE u.table_name='care_package_item_usages' AND u.record_key=? AND u.owner_id=?)`)
    .bind(ownerId,packageId,now,now,now,packageKey,ownerId,usageKey,ownerId);
}
async function usageByKey(database,ownerId,key){return ownedRecord(database,'care_package_item_usages',key,ownerId)}
async function consumePackageItem(database,user,input){
  const itemId=String(input?.p_item_id||'').trim(),key=String(input?.p_request_key||'').trim();
  if(!itemId)return runtimeJson(400,{message:'Item obrigatório.'});
  if(!key)return runtimeJson(400,{message:'Identificador da operação obrigatório.'});
  const replay=await usageByKey(database,user.id,key);
  if(replay){
    if(String(replay.record?.package_item_id||'')!==itemId)return runtimeJson(409,{message:'Identificador da operação já utilizado.',error:'request_key_conflict'});
    const current=await ownedRecord(database,'care_package_items',itemId,user.id);
    return runtimeJson(200,{item:current?.record||null,usage_id:key,package_id:replay.record.package_id,idempotent:true});
  }
  const initial=await ownedRecord(database,'care_package_items',itemId,user.id);
  if(!initial||initial.record?.status==='cancelled')return runtimeJson(404,{message:'Item não encontrado, cancelado ou sem permissão.'});
  const packageId=String(initial.record?.package_id||'');
  const pkg=await ownedPackage(database,packageId,user.id);
  if(!pkg||pkg.record?.status==='cancelled')return runtimeJson(404,{message:'Plano não encontrado, cancelado ou sem permissão.'});
  const appointmentId=input?.p_appointment_id?String(input.p_appointment_id):'';
  if(appointmentId){const appointment=await ownedRecord(database,'appointments',appointmentId,user.id);if(!appointment||String(appointment.record?.mother_id||'')!==String(initial.record?.mother_id||''))return runtimeJson(409,{message:'Agendamento incompatível com este plano.'});}
  const encounterId=input?.p_encounter_id?String(input.p_encounter_id):'';
  if(encounterId){const encounter=await ownedRecord(database,'clinical_encounters',encounterId,user.id);if(!encounter||String(encounter.record?.mother_id||'')!==String(initial.record?.mother_id||''))return runtimeJson(409,{message:'Prontuário incompatível com este plano.'});}

  for(let attempt=0;attempt<5;attempt+=1){
    const current=await ownedRecord(database,'care_package_items',itemId,user.id);
    if(!current)return runtimeJson(404,{message:'Item não encontrado.'});
    const used=Number(current.record?.quantity_used||0),total=Number(current.record?.quantity_total||0);
    if(used>=total)return runtimeJson(409,{message:'Todas as utilizações deste serviço já foram consumidas.'});
    const now=new Date().toISOString(),claimKey=`package_item_claim:${itemId}:${key}:${crypto.randomUUID()}`;
    const usage={id:key,owner_id:user.id,package_id:packageId,package_item_id:itemId,mother_id:current.record.mother_id||null,appointment_id:appointmentId||null,encounter_id:encounterId||null,notes:String(input?.p_notes||''),request_key:key,consumed_at:now,used_at:now,created_at:now,updated_at:now};
    let results;
    try{
      results=await database.batch([
        itemClaimStatement(database,{itemKey:current.key,ownerId:user.id,expectedUsed:used,claimKey,usageKey:key,now}),
        usageInsertStatement(database,{usageKey:key,ownerId:user.id,itemKey:current.key,claimKey,recordJson:JSON.stringify(usage),now}),
        packageStatusAfterUsageStatement(database,{packageKey:pkg.key,packageId,ownerId:user.id,usageKey:key,now}),
        itemClaimCleanupStatement(database,{itemKey:current.key,ownerId:user.id,claimKey,now}),
      ]);
    }catch(error){
      const raced=await usageByKey(database,user.id,key);
      if(raced){const item=await ownedRecord(database,'care_package_items',itemId,user.id);return runtimeJson(200,{item:item?.record||null,usage_id:key,package_id:packageId,idempotent:true});}
      throw error;
    }
    const [persistedUsage,persistedItem]=await Promise.all([usageByKey(database,user.id,key),ownedRecord(database,'care_package_items',itemId,user.id)]);
    if(changes(results?.[0])===1&&persistedUsage)return runtimeJson(200,{item:persistedItem?.record||null,usage_id:key,package_id:packageId,idempotent:false});
    if(persistedUsage)return runtimeJson(200,{item:persistedItem?.record||null,usage_id:key,package_id:packageId,idempotent:true});
    if(Number(persistedItem?.record?.quantity_used||0)>=Number(persistedItem?.record?.quantity_total||0))return runtimeJson(409,{message:'Todas as utilizações deste serviço já foram consumidas.'});
    if(Number(persistedItem?.record?.quantity_used||0)!==used)continue;
    return runtimeJson(409,{message:'Item alterado por outra operação. Tente novamente.',error:'package_item_concurrency_conflict'});
  }
  return runtimeJson(409,{message:'Item alterado por outra operação. Tente novamente.',error:'package_item_concurrency_conflict'});
}

export async function handleAtomicPackageIntegrityRuntime(request,env,url=new URL(request.url)){
  if(!env.CLINICAL_DB||request.method!=='POST')return null;
  if(![SET_BILLING_PATH,ADD_ITEM_PATH,CONSUME_ITEM_PATH].includes(url.pathname))return null;
  const input=await request.clone().json().catch(()=>({}));
  if(url.pathname===SET_BILLING_PATH&&String(input?.p_billing_mode||'')!=='package_new')return null;
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id)return runtimeJson(401,{message:'Sessão expirada. Entre novamente.'});
  const database=requireDb(env);
  try{
    if(url.pathname===SET_BILLING_PATH)return setPackageBilling(database,user,input);
    if(url.pathname===ADD_ITEM_PATH)return addPackageItem(database,user,input);
    return consumePackageItem(database,user,input);
  }catch(error){
    console.error('atomic package integrity operation failed',error);
    return runtimeJson(503,{message:'Não foi possível atualizar o plano. Tente novamente.'});
  }
}
