export const MANUAL_DEBORA_LICENSE_SOURCE = 'mercado_livre_manual';

export async function resolvePregrantedAccess(env, email) {
  if (!env.ARTISYS_LICENSING?.fetch || !env.LICENSE_SERVICE_SECRET) throw new Error('licensing_not_configured');
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST', headers: {'content-type':'application/json','x-artisys-license-secret':env.LICENSE_SERVICE_SECRET},
    body: JSON.stringify({action:'resolve',productCode:'debora-lactacao',email}),
  }));
  const access = await response.json().catch(()=>null);
  if (!response.ok || !access || typeof access.commercial !== 'boolean' || typeof access.active !== 'boolean') throw new Error('licensing_unavailable');
  return access.commercial && access.active ? access : null;
}

export function isDirectManualDeboraGrant(access) {
  return Boolean(
    access
    && access.commercial === true
    && access.active === true
    && access.planCode === 'pro_6m'
    && access.source === MANUAL_DEBORA_LICENSE_SOURCE
  );
}

// Non-manual commercial pregrants still require mailbox proof before credentials
// are installed. Manual 6-month grants are handled directly by /api/auth/signup.
export async function reservePregrantedIdentity(env, email, userId = crypto.randomUUID(), resolvedAccess = null) {
  const access = resolvedAccess || await resolvePregrantedAccess(env, email);
  if (!access) return null;
  const now = new Date().toISOString();
  await env.CLINICAL_DB.prepare(`INSERT INTO auth_users(user_id,email,created_at,updated_at,user_metadata_json,app_metadata_json,password_reset_required,migrated_at)
    VALUES(?,?,?,?,'{}',?,1,?) ON CONFLICT DO NOTHING`)
    .bind(userId,email,now,now,JSON.stringify({auth_backend:'cloudflare-d1',commercial_account:true,mailbox_claim_required:true}),now).run();
  return {error:'password_reset_required',message:'Este e-mail possui um benefício reservado. Use “Esqueci minha senha” para confirmar o acesso ao e-mail e definir sua senha. Se a recuperação estiver indisponível, contate o suporte.'};
}
