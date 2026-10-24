import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { matchSafetyRule, MOTHER_AI_SYSTEM_PROMPT, responseLooksUnsafe } from './mother-ai-safety.js';
import { searchApprovedBreastfeedingSources } from './mother-ai-knowledge.js';
import { verifiedMotherAiAccess } from './mother-ai-identity.js';
import { selectMotherApprovedOrientations, publishedOrientationContext } from './mother-ai-context.js';
import { saveMotherAiTurn } from './mother-ai-history-runtime.js';
import {isMotherAiPilotAllowed,recordMotherAiMetric} from './mother-ai-pilot.js';

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
function modelPrompt(message,sources,approvedContext='') {
  const evidence=sources.map((source,index)=>'[FONTE '+(index+1)+'] '+source.title+'\n'+source.summary).join('\n\n');
  return MOTHER_AI_SYSTEM_PROMPT+'\n\nFONTES SELECIONADAS:\n'+evidence+(approvedContext?'\n\nORIENTAÇÕES INDIVIDUAIS JÁ PUBLICADAS (dados fornecidos com consentimento):\n'+approvedContext:'')+'\n\nPERGUNTA:\n'+message+
    '\n\nResponda somente com base nas fontes listadas, sem inventar evidências.';
}
/** No UI, file uploads, AI Search calls, saved chat text or private patient data. */
export async function handleMotherAiChat(request,env,url=new URL(request.url),deps={}) {
  if(!['/api/member/ai/chat','/api/member/ai/config'].includes(url.pathname)) return null;
  if(url.pathname==='/api/member/ai/config' && request.method!=='GET') return json(405,{error:'method_not_allowed'});
  if(url.pathname==='/api/member/ai/chat' && request.method!=='POST') return json(405,{error:'method_not_allowed'});
  if(!on(env.MOTHER_PORTAL_ENABLED))
    return json(403,{error:'mother_ai_disabled',message:'Assistente ainda não liberada.'});
  if(!env.CLINICAL_DB) return json(503,{error:'clinical_database_required'});
  const authenticate=deps.authenticate||authenticateClinicalRequest;
  let user;
  try{user=await authenticate(request,env)}catch{return json(401,{error:'authentication_required'})}
  if(!user?.id) return json(401,{error:'authentication_required'});
  let access;
  try{access=await verifiedMotherAiAccess(env.CLINICAL_DB,user)}
  catch{return json(503,{error:'authorization_unavailable'})}
  if(!access) return json(403,{error:'verified_mother_access_required'});
  // Even a fully authenticated mother sees the chat only after manual clinical pilot enrolment.
  let allowed=false;
  try {allowed=await isMotherAiPilotAllowed(env,access)} catch {return json(503,{error:'pilot_authorization_unavailable'})}
  if(!allowed)return json(403,{error:'mother_ai_pilot_not_authorized',message:'O assistente ainda não está liberado para esta conta.'});
  if(url.pathname==='/api/member/ai/config') return json(200,{
    enabled:on(env.MOTHER_AI_ENABLED),
    inference_enabled:on(env.MOTHER_AI_ENABLED)&&on(env.MOTHER_AI_ALLOW_INFERENCE)&&on(env.MOTHER_AI_INFERENCE_BILLING_APPROVED)&&!!env.AI?.run
      &&limit(env.MOTHER_AI_GLOBAL_DAILY_LIMIT,GLOBAL_HARD_CAP)>0,
    history_opt_in:true,history_retention_days:30
  });
  if(!on(env.MOTHER_AI_ENABLED)) return json(403,{error:'mother_ai_disabled'});

  if(Number(request.headers.get('content-length')||'0')>1800) return json(413,{error:'message_too_long'});
  let content;
  try{
    const raw=await request.text();
    if(raw.length>1800) return json(413,{error:'message_too_long'});
    content=JSON.parse(raw);
  }catch{return json(400,{error:'invalid_body'})}
  const message=normalizeMessage(content);
  if(!message) return json(400,{error:'invalid_message',message:'Escreva uma pergunta de 4 a 500 caracteres.'});
  const saveRequested=content.save_to_history===true;
  const metric=(event,mode='free')=>recordMotherAiMetric(env,event,mode);
  const respond=async (payload,status=200)=>{
    const next={...payload};
    if(saveRequested && payload.answer) {
      try {
        next.message_id=await saveMotherAiTurn(env,access,user,message,payload);
        next.history_saved=true;
      }catch {
        next.history_saved=false;
        await metric('history_failed');
        next.history_error='A resposta foi exibida, mas o histórico não pôde ser salvo.';
      }
    }
    return json(status,next);
  };
  const safety=matchSafetyRule(message);
  if(safety){await metric(safety.kind==='urgent'?'urgent_escalation':'clinical_escalation');return respond({answer:safety.answer,classification:safety.kind,model_used:false,sources:[]})}
  let orientations=[];
  if(content.include_my_orientations===true) {
    try{orientations=await selectMotherApprovedOrientations(env.CLINICAL_DB,access.ownerId,access.motherId)}
    catch{return json(503,{error:'orientation_unavailable',message:'Não foi possível carregar suas orientações. Tente novamente.'})}
  }
  const sources=searchApprovedBreastfeedingSources(message);
  if(!sources.length && !orientations.length){await metric('out_of_scope');return respond({
    answer:'Não encontrei uma fonte aprovada para responder a essa pergunta com segurança. Consulte sua consultora de amamentação.',
    classification:'out_of_scope',model_used:false,sources:[]
  });}
  const publicReferencesOnly=async()=>{await metric('reference_answer');return respond({
    answer:orientations.length
      ? 'Consulte abaixo as orientações publicadas por sua consultora. Se algo não estiver claro, peça uma avaliação individual.'
      : 'Estas referências oficiais podem ajudar com a sua dúvida. Para orientação individual, fale com sua consultora.',
    classification:'reference_only',model_used:false,sources,orientations
  });}
  // No approved scientific material means the clinical content is shown for reading, not transformed by a model.
  if(!sources.length||!on(env.MOTHER_AI_ALLOW_INFERENCE)||!on(env.MOTHER_AI_INFERENCE_BILLING_APPROVED)||!env.AI?.run) return publicReferencesOnly();
  if(content.consent_to_ai_processing!==true) {
    return json(412,{error:'consent_required',message:'Confirme o uso da sua pergunta pela IA antes de solicitar a resposta.'});
  }
  // Additional, independent consent for using individually published clinical context in the model.
  const contextForModel=(content.consent_to_clinical_context===true && content.include_my_orientations===true)
    ? publishedOrientationContext(orientations) : '';
  let reserved=false;
  try{reserved=await reserveBudget(env,access.ownerId,access.motherId)}
  catch{return json(503,{error:'ai_budget_unavailable',message:'Assistente indisponível. Nenhuma chamada ao modelo foi feita.'})}
  if(!reserved){await metric('budget_denied');return json(429,{
    error:'ai_daily_limit_reached',
    message:'O limite diário do assistente foi atingido. As orientações da consultora continuam disponíveis.',
    model_used:false
  });}
  try{
    const output=await env.AI.run(MODEL,{
      prompt:modelPrompt(message,sources,contextForModel),max_tokens:MAX_ANSWER_TOKENS,
      temperature:0.15,stream:false
    });
    const answer=String(output?.response||'').trim().slice(0,1300);
    if(!answer||responseLooksUnsafe(answer)){await metric('model_error','inference');return respond({
      answer:'Não consegui produzir uma resposta suficientemente segura. Consulte sua consultora.',
      classification:'review_needed',model_used:true,sources,orientations
    });}
    await metric('model_answer','inference');return respond({answer,classification:'educational',model_used:true,sources,orientations});
  }catch{
    await metric('model_error','inference');return json(503,{error:'ai_unavailable',message:'A assistente está indisponível. Você pode consultar os materiais da sua consultora.'});
  }
}