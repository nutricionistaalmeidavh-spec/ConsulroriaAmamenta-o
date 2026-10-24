// Pilot authorization and privacy-safe, low-cardinality counters.
// No prompts, patient identifiers, client metadata, IP addresses or AI answers
// are ever accepted into the telemetry schema.
const enabled = value => String(value??'false').toLowerCase()==='true';
const EVENTS=new Set(['reference_answer','clinical_escalation','urgent_escalation','out_of_scope','budget_denied','model_answer','model_error','history_failed']);
const MODES=new Set(['free','inference']);
export function isMotherAiPilotActive(env){
  return enabled(env.MOTHER_PORTAL_ENABLED)
    && enabled(env.MOTHER_AI_ENABLED)
    && enabled(env.MOTHER_AI_PILOT_ENABLED)
    && enabled(env.MOTHER_AI_CLINICAL_REVIEW_APPROVED);
}
export async function isMotherAiPilotAllowed(env,access) {
  if(!env?.CLINICAL_DB||!access||!isMotherAiPilotActive(env)) return false;
  const bound=await env.CLINICAL_DB.prepare(
    'SELECT approved_at FROM mother_ai_pilot_allowlist WHERE owner_id=? AND mother_id=? AND member_user_id=? AND approved_at<=? AND expires_at>? AND revoked_at IS NULL LIMIT 1'
  ).bind(access.ownerId,access.motherId,access.memberUserId,new Date().toISOString(),new Date().toISOString()).first();
  return !!bound;
}
export async function recordMotherAiMetric(env,event,mode){
  if(!enabled(env?.MOTHER_AI_TELEMETRY_ENABLED) || !env.CLINICAL_DB || !EVENTS.has(event) || !MODES.has(mode)) return false;
  try {
    const today=new Date().toISOString().slice(0,10);
    await env.CLINICAL_DB.prepare(
      'INSERT INTO mother_ai_pilot_metrics(day,event,mode,count) VALUES(?,?,?,1) ON CONFLICT(day,event,mode) DO UPDATE SET count=count+1'
    ).bind(today,event,mode).run();
    return true;
  }catch{return false} // Operational telemetry must never interrupt clinical assistance.
}
export async function readMotherAiMetrics(db,days=7){
  const n=Number.isInteger(days)?Math.max(1,Math.min(days,30)):7;
  const from=new Date(Date.now()-(n-1)*86400000).toISOString().slice(0,10);
  const rows=await db.prepare(
    'SELECT day,event,mode,count FROM mother_ai_pilot_metrics WHERE day>=? ORDER BY day DESC,event ASC LIMIT 300'
  ).bind(from).all();
  return rows.results||[];
}