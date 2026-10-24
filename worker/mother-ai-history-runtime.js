import {authenticateClinicalRequest} from './cloudflare-auth-runtime.js';
import {verifiedMotherAiAccess} from './mother-ai-identity.js';

const HOURS_30_DAYS=30*86400000;
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-robots-tag':'noindex, nofollow'
}});
const enabled=env=>String(env.MOTHER_PORTAL_ENABLED||'false').toLowerCase()==='true';
const replyRow=row=>({
 id:row.id,question:row.question,answer:row.answer,
 classification:row.classification,created_at:row.created_at,
 sources:(()=>{try{return JSON.parse(row.sources_json)}catch{return []}})(),
 feedback:row.feedback||null,shared:!!row.shared_at,shared_at:row.shared_at||null
});
async function scoped(db,access,user,id) {
 return db.prepare("SELECT * FROM mother_ai_history WHERE id=? AND owner_id=? AND mother_id=? AND member_user_id=? AND expires_at>? LIMIT 1")
  .bind(id,access.ownerId,access.motherId,user.id,new Date().toISOString()).first();
}
/** No automatic saves: caller opts in for each message. Never called with raw client answer. */
export async function saveMotherAiTurn(env,access,user,message,response) {
 const id=crypto.randomUUID(), created=new Date().toISOString();
 const expires=new Date(Date.now()+HOURS_30_DAYS).toISOString();
 const sources=(response.sources||[]).slice(0,3).map(x=>({id:x.id,title:x.title,url:x.url}));
 await env.CLINICAL_DB.prepare(
  'INSERT INTO mother_ai_history(id,owner_id,mother_id,member_user_id,question,answer,classification,sources_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)'
 ).bind(id,access.ownerId,access.motherId,user.id,message.slice(0,500),
   String(response.answer||'').slice(0,1800),String(response.classification||'educational').slice(0,32),
   JSON.stringify(sources),created,expires).run();
 return id;
}
async function getProfessionalInbox(db,user,motherId) {
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(motherId))return json(400,{error:'invalid_mother'});
 const mother=await db.prepare(
  "SELECT record_key FROM supabase_records WHERE table_name='mothers' AND owner_id=? AND record_key=? LIMIT 1"
 ).bind(user.id,motherId).first();
 if(!mother) return json(403,{error:'patient_not_owned'});
 const records=await db.prepare(
  'SELECT id,question,answer,classification,sources_json,created_at,shared_at FROM mother_ai_history WHERE owner_id=? AND mother_id=? AND shared_at IS NOT NULL AND expires_at>? ORDER BY shared_at DESC LIMIT 30'
 ).bind(user.id,motherId,new Date().toISOString()).all();
 return json(200,{items:(records.results||[]).map(replyRow)});
}
export async function handleMotherAiHistory(request,env,url=new URL(request.url),deps={}) {
 const path=url.pathname;
 if(!path.startsWith('/api/member/ai/history') && !path.startsWith('/api/member/ai/shares')
  && path!=='/api/member/ai/consultant/shares')return null;
 if(!enabled(env))return json(403,{error:'mother_portal_disabled'});
 if(!env.CLINICAL_DB)return json(503,{error:'clinical_database_required'});
 let user;
 try{user=await (deps.authenticate||authenticateClinicalRequest)(request,env)}
 catch{return json(401,{error:'authentication_required'})}
 if(!user?.id)return json(401,{error:'authentication_required'});
 if(path==='/api/member/ai/consultant/shares') {
  if(request.method!=='GET')return json(405,{error:'method_not_allowed'});
  // A verified mother login cannot masquerade as the clinical owner of another patient.
  const linked=await verifiedMotherAiAccess(env.CLINICAL_DB,user);
  if(linked)return json(403,{error:'professional_role_required'});
  try{return await getProfessionalInbox(env.CLINICAL_DB,user,String(url.searchParams.get('mother_id')||''))}
  catch{return json(503,{error:'history_unavailable'})}
 }
 let access;
 try{access=await verifiedMotherAiAccess(env.CLINICAL_DB,user)}
 catch{return json(503,{error:'authorization_unavailable'})}
 if(!access)return json(403,{error:'verified_mother_access_required'});
 const db=env.CLINICAL_DB;
 try{
  if(path==='/api/member/ai/history') {
   if(request.method==='GET') {
    const rows=await db.prepare('SELECT * FROM mother_ai_history WHERE owner_id=? AND mother_id=? AND member_user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 30')
      .bind(access.ownerId,access.motherId,user.id,new Date().toISOString()).all();
    return json(200,{items:(rows.results||[]).map(replyRow),retention_days:30});
   }
   if(request.method==='DELETE') {
    const result=await db.prepare('DELETE FROM mother_ai_history WHERE owner_id=? AND mother_id=? AND member_user_id=?')
      .bind(access.ownerId,access.motherId,user.id).run();
    return json(200,{deleted:Number(result.meta?.changes||0),shared_copies_withdrawn:true});
   }
   return json(405,{error:'method_not_allowed'});
  }
  if(path.startsWith('/api/member/ai/history/') && path.endsWith('/feedback')) {
   if(request.method!=='PATCH')return json(405,{error:'method_not_allowed'});
   const id=path.split('/')[5];
   const payload=await request.json().catch(()=>({}));
   if(!['helpful','not_helpful',null].includes(payload?.feedback))return json(400,{error:'invalid_feedback'});
   if(!await scoped(db,access,user,id))return json(404,{error:'history_not_found'});
   await db.prepare('UPDATE mother_ai_history SET feedback=? WHERE id=? AND owner_id=? AND mother_id=? AND member_user_id=?')
    .bind(payload.feedback,id,access.ownerId,access.motherId,user.id).run();
   return json(200,{id,feedback:payload.feedback});
  }
  if(path==='/api/member/ai/shares' && request.method==='POST') {
   const payload=await request.json().catch(()=>({}));
   if(payload?.confirm_share!==true||typeof payload.message_id!=='string')
    return json(400,{error:'explicit_sharing_confirmation_required'});
   const row=await scoped(db,access,user,payload.message_id);
   if(!row)return json(404,{error:'history_not_found'});
   const at=row.shared_at || new Date().toISOString();
   await db.prepare('UPDATE mother_ai_history SET shared_at=? WHERE id=? AND owner_id=? AND mother_id=? AND member_user_id=?')
    .bind(at,row.id,access.ownerId,access.motherId,user.id).run();
   return json(200,{id:row.id,shared:true,shared_at:at,delivery:'consultant_inbox'});
  }
  if(path.startsWith('/api/member/ai/shares/') && request.method==='DELETE') {
   const id=path.slice('/api/member/ai/shares/'.length);
   if(!await scoped(db,access,user,id))return json(404,{error:'history_not_found'});
   await db.prepare('UPDATE mother_ai_history SET shared_at=NULL WHERE id=? AND owner_id=? AND mother_id=? AND member_user_id=?')
    .bind(id,access.ownerId,access.motherId,user.id).run();
   return json(200,{id,shared:false});
  }
  return json(404,{error:'not_found'});
 }catch{
  return json(503,{error:'history_unavailable',message:'Não foi possível completar a ação. Tente novamente.'});
 }
}