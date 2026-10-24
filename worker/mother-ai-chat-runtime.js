import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { matchSafetyRule, MOTHER_AI_SYSTEM_PROMPT, responseLooksUnsafe } from './mother-ai-safety.js';
import { searchApprovedBreastfeedingSources } from './mother-ai-knowledge.js';

const MODEL='@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const MAX_ANSWER_TOKENS=240;
const GLOBAL_HARD_CAP=4; // Max total model invocations across this SaaS per UTC day.
function json(status,body) {
  return new Response(JSON.stringify(body),{status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','x-robots-tag':'noindex, nofollow'
  }});
}
function on(value){return String(value ?? 'false').toLowerCase()==='true';}
function limit(value,max,defaultValue=0){
  if(!/^\d+$/.test(String(value??''))) return defaultValue;
  return Math.min(Number(value),max);
}
function active(record){return ![false,0,'0','false','disabled','inactive','cancelled'].includes(record?.active);}
async function verifiedAccess(db,user) {
  const rows=await db.prepare("SELECT owner_id,record_json FROM supabase_records WHERE table_name='member_portal_access' AND json_extract(record_json,'$.member_user_id') = ? LIMIT 3")
    .bind(user.id).all();
  const activeRows=(rows.results||[]).flatMap(row=>{
    try {
      const record=JSON.parse(row.record_json);
      const ownerId=String(row.owner_id||record.owner_id||'');
      if(!ownerId || ownerId!==String(record.owner_id||ownerId) || !String(record.mother_id||'') ||
        !active(record) || !Number.isFinite(Date.parse(record.member_verified_at||'')) ||
        String(record.member_user_id)!==String(user.id)) return [];
      return [{ownerId,motherId:String(record.mother_id)}];
    }catch{return []}
  });
  // Multiple tenant identities are ambiguous: never select a mother by user-supplied ID.
  return activeRows.length===1 ? activeRows[0] : null;
}
async function consumeOne(db,day,scope,id,max) {
  if(max<1) return false;
  const run=await db.prepare('INSERT INTO mother_ai_daily_usage(day,scope,scope_id,calls) VALUES(?,?,?,1) ON CONFLICT(day,scope,scope_id) DO UPDATE SET calls=calls+1 WHERE calls < ?')
    .bind(day,scope,id,max).run();
  return Number(run.meta?.changes||0)===1;
}
async function reserveBudget(env,ownerId,motherId) {
  const global=limit(env.MOTHER_AI_GLOBAL_DAILY_LIMIT,GLOBAL_HARD_CAP);
  const owner=limit(env.MOTHER_AI_OWNER_DAILY_LIMIT,GLOBAL_HARD_CAP);
  const mother=limit(env.MOTHER_AI_MOTHER_DAILY_LIMIT,GLOBAL_HARD_CAP);
  if(!global||!owner||!mother) return false;
  const day=new Date().toISOString().slice(0,10);
  // Conservative non-refundable reservations: a rejected request may use quota
  // but cannot trigger an extra inference. Each UPSERT is an atomic SQLite write.
  if(!await consumeOne(env.CLINICAL_DB,day,'global','account',global)) return false;
  if(!await consumeOne(env.CLINICAL_DB,day,'owner',ownerId,owner)) return false;
  if(!await consumeOne(env.CLINICAL_DB,day,'mother',ownerId+':'+motherId,mother)) return false;
  return true;
}
function normalizeMessage(content) {
  if(typeof content!=='object'||!content||Array.isArray(content)) return null;
  const message=content.message;
  if(typeof message!=='string'||message.trim().length<4||message.length>500) return null;
  return message.trim();
}
function modelPrompt(message,sources) {
  const evidence=sources.map((source,index)=>'[FONTE '+(index+1)+'] '+source.title+'\n'+source.summary).join('\n\n');
  return MOTHER_AI_SYSTEM_PROMPT+'\n\nFONTES SELECIONADAS:\n'+evidence+'\n\nPERGUNTA:\n'+message+
    '\n\nResponda somente com base nas fontes listadas, sem inventar evidências.';
}
/** No UI, file uploads, AI Search calls, saved chat text or private patient data. */
export async function handleMotherAiChat(request,env,url=new URL(request.url),deps={}) {
  if(url.pathname!=='/api/member/ai/chat') return null;
  if(request.method!=='POST') return json(405,{error:'method_not_allowed'});
  if(!on(env.MOTHER_PORTAL_ENABLED)||!on(env.MOTHER_AI_ENABLED))
    return json(403,{error:'mother_ai_disabled',message:'Assistente ainda não liberada.'});
  if(!env.CLINICAL_DB) return json(503,{error:'clinical_database_required'});
  const authenticate=deps.authenticate||authenticateClinicalRequest;
  let user;
  try{user=await authenticate(request,env)}catch{return json(401,{error:'authentication_required'})}
  if(!user?.id) return json(401,{error:'authentication_required'});
  let access;
  try{access=await verifiedAccess(env.CLINICAL_DB,user)}
  catch{return json(503,{error:'authorization_unavailable'})}
  if(!access) return json(403,{error:'verified_mother_access_required'});
  if(Number(request.headers.get('content-length')||'0')>1800) return json(413,{error:'message_too_long'});
  let content;
  try{
    const raw=await request.text();
    if(raw.length>1800) return json(413,{error:'message_too_long'});
    content=JSON.parse(raw);
  }catch{return json(400,{error:'invalid_body'})}
  const message=normalizeMessage(content);
  if(!message) return json(400,{error:'invalid_message',message:'Escreva uma pergunta de 4 a 500 caracteres.'});
  const safety=matchSafetyRule(message);
  if(safety) return json(200,{answer:safety.answer,classification:safety.kind,model_used:false,sources:[]});
  const sources=searchApprovedBreastfeedingSources(message);
  if(!sources.length) return json(200,{
    answer:'Não encontrei uma fonte aprovada para responder a essa pergunta com segurança. Consulte sua consultora de amamentação.',
    classification:'out_of_scope',model_used:false,sources:[]
  });
  // Free references without an AI model. No paid AI Search service is contacted.
  if(!on(env.MOTHER_AI_ALLOW_INFERENCE)||!env.AI?.run) {
    return json(200,{
      answer:'Estas referências oficiais podem ajudar com a sua dúvida. Para orientação individual, fale com sua consultora.',
      classification:'reference_only',model_used:false,sources
    });
  }
  if(content.consent_to_ai_processing!==true) {
    return json(412,{error:'consent_required',
      message:'Confirme o uso da sua pergunta pela IA antes de solicitar a resposta.'});
  }
  let reserved=false;
  try{reserved=await reserveBudget(env,access.ownerId,access.motherId)}
  catch{return json(503,{error:'ai_budget_unavailable',message:'Assistente indisponível. Nenhuma chamada ao modelo foi feita.'})}
  if(!reserved)return json(429,{
    error:'ai_daily_limit_reached',
    message:'O limite diário do assistente foi atingido. As orientações da consultora continuam disponíveis.',
    model_used:false
  });
  try{
    const output=await env.AI.run(MODEL,{
      prompt:modelPrompt(message,sources),max_tokens:MAX_ANSWER_TOKENS,
      temperature:0.15,stream:false
    });
    const answer=String(output?.response||'').trim().slice(0,1300);
    if(!answer||responseLooksUnsafe(answer)) return json(200,{
      answer:'Não consegui produzir uma resposta suficientemente segura. Consulte sua consultora.',
      classification:'review_needed',model_used:true,sources
    });
    return json(200,{answer,classification:'educational',model_used:true,sources});
  }catch{
    // Do not refund a consumed call: retries must never multiply inference cost.
    return json(503,{error:'ai_unavailable',message:'A assistente está indisponível. Você pode consultar os materiais da sua consultora.'});
  }
}