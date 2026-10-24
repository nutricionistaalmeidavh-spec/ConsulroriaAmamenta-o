import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { isAuthenticatedMother } from './block6-rpc-runtime.js';

export const GENERIC_EVENT_TITLE = 'Atendimento - Gestão Amamentação';
const TABLE = 'calendar_event_display_preferences';

function json(status, body) {
  return new Response(JSON.stringify(body), {status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
    'x-robots-tag':'noindex, nofollow',
  }});
}
function cleanLabel(value, max = 90) {
  // No CRLF, tabs, control characters, invisible directional overrides or long strings.
  return String(value || '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,max).trim();
}
function appointmentCategory(raw) {
  const type=cleanLabel(raw,70);
  if (!type) return 'Atendimento';
  if (/consulta|primeira|inicial/i.test(type)) return 'Consulta';
  if (/retorno/i.test(type)) return 'Retorno';
  if (/acompanhamento/i.test(type)) return 'Acompanhamento';
  if (/pré.natal|pre.natal/i.test(type)) return 'Pré-natal';
  // Free-text appointment types may themselves contain clinical diagnoses.
  return 'Atendimento';
}
export function calendarEventTitle(appointment, motherName, enabled) {
  const name=cleanLabel(motherName,80);
  return enabled && name ? appointmentCategory(appointment?.appointment_type)+' — '+name : GENERIC_EVENT_TITLE;
}
export function escapeIcsText(value) {
  return String(value).replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
}
async function enabled(db, ownerId) {
  try {
    const row=await db.prepare('SELECT show_patient_name FROM '+TABLE+' WHERE owner_id=?').bind(ownerId).first();
    return Number(row?.show_patient_name)===1;
  } catch(e) {
    // On first rollout, the optional schema may not be present until first login.
    if (/no such table/i.test(String(e?.message))) return false;
    throw e;
  }
}
async function ownersMothers(db, ownerId) {
  const rows=await db.prepare('SELECT record_json FROM supabase_records WHERE table_name=? AND owner_id=? LIMIT 2000')
    .bind('mothers',ownerId).all();
  const names=new Map();
  for(const row of rows.results || []) {
    try {
      const m=JSON.parse(row.record_json);
      if(m.id && (!m.owner_id || m.owner_id===ownerId)) names.set(m.id,m.name);
    } catch { /* malformed record ignored */ }
  }
  return names;
}
export async function calendarEventTitlesForOwner(env, ownerId, appointments) {
  const result=new Map();
  if (!ownerId || !env?.CLINICAL_DB || !Array.isArray(appointments) || appointments.length===0) return result;
  const allow=await enabled(env.CLINICAL_DB,ownerId);
  if (!allow) return result;
  const names=await ownersMothers(env.CLINICAL_DB,ownerId);
  for(const appointment of appointments) {
    if(appointment?.id && appointment?.owner_id===ownerId) {
      result.set(appointment.id,calendarEventTitle(appointment,names.get(appointment.mother_id),true));
    }
  }
  return result;
}
export async function handleCalendarDisplayPreferences(request,env,url=new URL(request.url)) {
  if(url.pathname!=='/api/calendar/display-preferences') return null;
  if (!['GET','POST'].includes(request.method)) return json(405,{error:'method_not_allowed'});
  if (!env.CLINICAL_DB) return json(503,{error:'cloudflare_d1_required'});
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id) return json(401,{error:'cloudflare_auth_required'});
  if(await isAuthenticatedMother(env,user)) return json(403,{error:'professional_only'});
  try {
    await env.CLINICAL_DB.prepare('CREATE TABLE IF NOT EXISTS '+TABLE+' (owner_id TEXT PRIMARY KEY, show_patient_name INTEGER NOT NULL DEFAULT 0 CHECK(show_patient_name IN (0,1)), updated_at TEXT NOT NULL)').run();
    if(request.method==='GET') return json(200,{show_patient_name:await enabled(env.CLINICAL_DB,user.id)});
    const input=await request.json().catch(()=>null);
    if(typeof input?.show_patient_name!=='boolean' || (input.show_patient_name && input.acknowledged_external_visibility!==true)) {
      return json(400,{error:'acknowledgement_required'});
    }
    await env.CLINICAL_DB.prepare('INSERT INTO '+TABLE+' (owner_id,show_patient_name,updated_at) VALUES (?,?,?) ON CONFLICT(owner_id) DO UPDATE SET show_patient_name=excluded.show_patient_name,updated_at=excluded.updated_at')
      .bind(user.id,input.show_patient_name?1:0,new Date().toISOString()).run();
    return json(200,{show_patient_name:input.show_patient_name});
  }catch(e){
    console.error('calendar display preference failed',String(e?.name||'error'));
    return json(503,{error:'calendar_display_unavailable'});
  }
}
