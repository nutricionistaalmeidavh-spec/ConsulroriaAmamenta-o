import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { runtimeJson } from './cloudflare-data-runtime.js';

const OBJECT_PREFIX='/api/files/object/';
const SIGN_PREFIX='/api/files/object/sign/';
const CLAIM_TABLE='storage_delete_claims';

function parseTarget(url){
  if(!url.pathname.startsWith(OBJECT_PREFIX)||url.pathname.startsWith(SIGN_PREFIX))return null;
  const relative=url.pathname.slice(OBJECT_PREFIX.length);
  const [bucketEncoded,...parts]=relative.split('/');
  const bucket=decodeURIComponent(bucketEncoded||'');
  const path=parts.map(decodeURIComponent).join('/');
  return bucket&&path?{bucket,path}:null;
}

async function metadataRow(db,bucket,path){
  return db.prepare(`SELECT source_bucket,source_path,r2_key,size_bytes,mime_type,metadata_json
    FROM storage_objects WHERE source_bucket=? AND source_path=? LIMIT 1`).bind(bucket,path).first();
}

function claimKey(bucket,path,r2Key){return `delete:${bucket}:${path}:${r2Key}`}
function claimRecord(user,target,r2Key,now){
  return {id:claimKey(target.bucket,target.path,r2Key),owner_id:user.id,bucket:target.bucket,path:target.path,r2_key:r2Key,state:'pending',created_at:now,updated_at:now};
}
function insertClaimStatement(db,user,target,r2Key,now){
  const record=claimRecord(user,target,r2Key,now);
  return db.prepare(`INSERT INTO supabase_records(
      table_name,record_key,owner_id,record_json,source_created_at,source_updated_at,migrated_at
    ) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(table_name,record_key) DO UPDATE SET
      owner_id=excluded.owner_id,record_json=excluded.record_json,
      source_updated_at=excluded.source_updated_at,migrated_at=excluded.migrated_at`)
    .bind(CLAIM_TABLE,record.id,user.id,JSON.stringify(record),now,now,now);
}
function conditionalMetadataDeleteStatement(db,target,r2Key){
  return db.prepare(`DELETE FROM storage_objects
    WHERE source_bucket = ? AND source_path = ? AND r2_key = ?`).bind(target.bucket,target.path,r2Key);
}
async function removeClaim(db,userId,target,r2Key){
  const key=claimKey(target.bucket,target.path,r2Key);
  await db.prepare(`DELETE FROM supabase_records
    WHERE table_name=? AND record_key=? AND owner_id=?`).bind(CLAIM_TABLE,key,userId).run();
}
async function pendingClaims(db,userId,target){
  const result=await db.prepare(`SELECT record_key,record_json FROM supabase_records
    WHERE table_name=? AND owner_id=?
      AND json_extract(record_json,'$.bucket')=?
      AND json_extract(record_json,'$.path')=?`).bind(CLAIM_TABLE,userId,target.bucket,target.path).all();
  return (result.results||[]).map(row=>{try{return JSON.parse(row.record_json)}catch{return null}}).filter(Boolean);
}
async function reconcileClaims(env,user,target){
  const claims=await pendingClaims(env.CLINICAL_DB,user.id,target);
  let cleaned=0;
  for(const claim of claims){
    try{
      await env.CLINICAL_FILES.delete(claim.r2_key);
      await removeClaim(env.CLINICAL_DB,user.id,target,claim.r2_key);
      cleaned+=1;
    }catch(error){
      console.warn('storage delete claim reconciliation deferred',error);
    }
  }
  return cleaned;
}

export async function handleClaimedStorageDelete(request,env,url=new URL(request.url)){
  if(request.method!=='DELETE')return null;
  const target=parseTarget(url);if(!target)return null;
  if(!env.CLINICAL_DB)return runtimeJson(503,{error:'cloudflare_d1_required'});
  if(!env.CLINICAL_FILES)return runtimeJson(503,{message:'R2 não configurado.'});
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id)return runtimeJson(401,{error:'cloudflare_auth_required',message:'Sessão expirada.'});
  if(!target.path||target.path.includes('..'))return runtimeJson(400,{message:'Caminho inválido.'});
  if(!target.path.startsWith(`${user.id}/`))return runtimeJson(403,{message:'Arquivo fora do escopo da conta.'});

  // Finish any prior physical cleanup for this logical path before claiming a new version.
  await reconcileClaims(env,user,target);
  const current=await metadataRow(env.CLINICAL_DB,target.bucket,target.path);
  if(!current)return new Response(null,{status:204});
  const r2Key=String(current.r2_key||'');
  if(!r2Key)return runtimeJson(409,{error:'storage_object_identity_missing'});
  const now=new Date().toISOString();

  // Claim + logical metadata removal are one D1 transaction. If the DELETE is
  // rejected, the claim is rolled back and R2 is never touched. A concurrent
  // rewrite with a new r2_key cannot be removed by this operation afterwards.
  try{
    await env.CLINICAL_DB.batch([
      insertClaimStatement(env.CLINICAL_DB,user,target,r2Key,now),
      conditionalMetadataDeleteStatement(env.CLINICAL_DB,target,r2Key),
    ]);
  }catch(error){
    console.error('storage delete claim failed',error);
    return runtimeJson(500,{error:'storage_metadata_delete_failed'});
  }

  const stillCurrent=await metadataRow(env.CLINICAL_DB,target.bucket,target.path);
  if(stillCurrent?.r2_key===r2Key){
    return runtimeJson(409,{error:'storage_delete_claim_conflict'});
  }

  try{
    await env.CLINICAL_FILES.delete(r2Key);
  }catch(error){
    console.error('storage object delete deferred after claim',error);
    return runtimeJson(503,{error:'storage_object_delete_pending'});
  }

  await removeClaim(env.CLINICAL_DB,user.id,target,r2Key).catch(error=>console.warn('storage delete claim cleanup deferred',error));
  return new Response(null,{status:204});
}
