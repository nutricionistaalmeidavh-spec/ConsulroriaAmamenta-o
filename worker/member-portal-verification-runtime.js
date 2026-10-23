import { sendTransactionalEmail } from './transactional-email.js';

function reply(status, data) {
  return new Response(JSON.stringify(data), {status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
const emailOf = v => String(v || '').trim().toLowerCase();
const active = v => ![false,0,'false','0','disabled','cancelled','inactive'].includes(v);
const isoNow = () => new Date().toISOString();
async function digest(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function randomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6,'0');
}
function randomSalt() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return [...b].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function availableInvite(db, email, userId) {
  const rows = await db.prepare(`SELECT record_key, record_json FROM supabase_records
    WHERE table_name='member_portal_access' AND lower(trim(json_extract(record_json,'$.email')))=?
    AND COALESCE(json_extract(record_json,'$.active'),1) NOT IN (0,'false','inactive','disabled')`)
    .bind(email).all();
  const available = (rows.results || []).map(row=>{try{return {id:row.record_key,record:JSON.parse(row.record_json)}}catch{return null}})
    .filter(x=>x && active(x.record.active) && !String(x.record.member_verified_at||'').trim() && (!String(x.record.member_user_id||'').trim() || String(x.record.member_user_id)===String(userId)));
  if (!available.length) return {error:reply(404,{error:'member_invite_not_found',message:'Convite disponível não encontrado. Entre em contato com sua consultora.'})};
  if (available.length !== 1) return {error:reply(409,{error:'member_invite_ambiguous',message:'Há mais de um convite para este e-mail. Solicite a correção à consultora.'})};
  return {invite:available[0]};
}
export async function requestMemberVerification(env, user) {
  if (!user?.id || !emailOf(user.email)) return reply(401,{error:'member_identity_required'});
  const db = env.CLINICAL_DB, email=emailOf(user.email);
  const {invite,error} = await availableInvite(db,email,user.id);
  if (error) return error;
  const now = isoNow();
  const previous = await db.prepare('SELECT created_at FROM member_portal_challenges WHERE user_id=?').bind(user.id).first();
  if (previous && Date.now()-Date.parse(previous.created_at)<60000) {
    return reply(429,{error:'mother_code_rate_limited',message:'Aguarde um minuto antes de solicitar outro código.'});
  }
  const code = randomCode(), salt = randomSalt();
  const codeHash = await digest([user.id,email,invite.id,salt,code].join(':'));
  const expires = new Date(Date.now()+15*60000).toISOString();
  await db.prepare(`INSERT INTO member_portal_challenges
    (user_id,access_id,email,code_salt,code_hash,expires_at,attempts,created_at)
    VALUES(?,?,?,?,?,?,0,?)
    ON CONFLICT(user_id) DO UPDATE SET access_id=excluded.access_id,email=excluded.email,
    code_salt=excluded.code_salt,code_hash=excluded.code_hash,expires_at=excluded.expires_at,
    attempts=0,created_at=excluded.created_at`)
    .bind(user.id,invite.id,email,salt,codeHash,expires,now).run();
  try {
    await sendTransactionalEmail(env,{kind:'mother_portal_code',to:email,data:{code}});
  } catch (e) {
    await db.prepare('DELETE FROM member_portal_challenges WHERE user_id=? AND code_hash=?').bind(user.id,codeHash).run();
    return reply(503,{error:'mother_portal_email_unavailable',message:'Não foi possível enviar o código. Tente novamente mais tarde.'});
  }
  return reply(200,{status:'verification_sent',message:'Enviamos um código ao e-mail do convite.'});
}
export async function verifyMemberVerification(env,user,request) {
  if (!user?.id || !emailOf(user.email)) return reply(401,{error:'member_identity_required'});
  const {code} = await request.json().catch(()=>({}));
  if (!/^\d{6}$/.test(String(code || ''))) return reply(400,{error:'invalid_verification_code',message:'Informe o código de seis dígitos.'});
  const db=env.CLINICAL_DB,challenge=await db.prepare('SELECT * FROM member_portal_challenges WHERE user_id=?').bind(user.id).first();
  if (!challenge || challenge.email!==emailOf(user.email) || Date.parse(challenge.expires_at)<=Date.now() || Number(challenge.attempts)>=5) {
    return reply(403,{error:'verification_expired',message:'Código expirado ou limite atingido. Solicite outro.'});
  }
  const expected=await digest([user.id,challenge.email,challenge.access_id,challenge.code_salt,code].join(':'));
  if (expected!==challenge.code_hash) {
    await db.prepare('UPDATE member_portal_challenges SET attempts=attempts+1 WHERE user_id=? AND attempts<5').bind(user.id).run();
    return reply(403,{error:'verification_invalid',message:'Código incorreto. Verifique e tente novamente.'});
  }
  const now=isoNow();
  const applied=await db.prepare(`UPDATE supabase_records SET
    record_json=json_set(record_json,'$.member_user_id',?,'$.claimed_at',?,'$.member_verified_at',?,'$.updated_at',?),
    source_updated_at=?
    WHERE table_name='member_portal_access' AND record_key=?
    AND lower(trim(json_extract(record_json,'$.email')))=?
    AND COALESCE(json_extract(record_json,'$.active'),1) NOT IN (0,'false','inactive','disabled')
    AND (json_extract(record_json,'$.member_user_id') IS NULL OR
         json_extract(record_json,'$.member_user_id')='' OR json_extract(record_json,'$.member_user_id')=?)
    AND (json_extract(record_json,'$.member_verified_at') IS NULL OR json_extract(record_json,'$.member_verified_at')='')`)
    .bind(user.id,now,now,now,now,challenge.access_id,challenge.email,user.id).run();
  await db.prepare('DELETE FROM member_portal_challenges WHERE user_id=?').bind(user.id).run();
  if (Number(applied.meta?.changes || 0)!==1) return reply(409,{error:'invite_already_claimed',message:'Esse convite já foi vinculado. Entre em contato com a consultora.'});
  const bound=await db.prepare(`SELECT record_json FROM supabase_records WHERE table_name='member_portal_access'
    AND record_key=? AND json_extract(record_json,'$.member_user_id')=?`).bind(challenge.access_id,user.id).first();
  if (!bound) return reply(503,{error:'member_binding_not_confirmed'});
  return reply(200,JSON.parse(bound.record_json));
}
