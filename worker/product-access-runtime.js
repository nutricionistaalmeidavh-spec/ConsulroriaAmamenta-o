const PRODUCT_CODE = 'debora-lactacao';

function unavailable() {
  return Object.assign(new Error('licensing_unavailable'), { code: 'licensing_unavailable', status: 503 });
}

async function licenseCall(env, body) {
  if (!env.ARTISYS_LICENSING?.fetch || !env.LICENSE_SERVICE_SECRET) throw unavailable();
  try {
    const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET },
      body: JSON.stringify({ ...body, productCode: PRODUCT_CODE }),
    }));
    if (!response.ok) throw unavailable();
    return await response.json();
  } catch { throw unavailable(); }
}

function validatedAccess(access) {
  if (!access || access.productCode !== PRODUCT_CODE) throw unavailable();
  const legacy = access.planCode === 'legacy_unmanaged' && access.commercial === false
    && access.active === true && access.enforceLimits === false && access.patientLimit === null
    && access.mediaUpload === true && access.status === 'unmanaged';
  const free = access.planCode === 'freemium' && access.commercial === true
    && access.active === false && access.enforceLimits === true && access.patientLimit === 3
    && access.mediaUpload === false && access.status === 'freemium';
  const pro = typeof access.planCode === 'string' && access.planCode.startsWith('pro_')
    && access.commercial === true && access.active === true && access.enforceLimits === true
    && access.patientLimit === null && access.mediaUpload === true
    && ['active', 'trialing'].includes(access.status)
    && (!access.expiresAt || Date.parse(access.expiresAt) > Date.now());
  if (!legacy && !free && !pro) throw unavailable();
  return access;
}

// Only persisted server-owned metadata or the existing D1 account registry can
// classify an account. User-editable profile metadata never grants access.
async function isCommercialAccount(env, user) {
  if (user.app_metadata?.commercial_account === true
    || user.app_metadata?.activation_source === 'asaas_verified_payment') return true;
  if (!env.CLINICAL_DB || !user.id) throw unavailable();
  try {
    const row = await env.CLINICAL_DB.prepare('SELECT 1 AS found FROM supabase_records WHERE table_name = ? AND owner_id = ? LIMIT 1')
      .bind('saas_accounts', user.id).first();
    return Boolean(row);
  } catch { throw unavailable(); }
}

export async function resolveProductAccess(env, user) {
  if (!user?.email) throw unavailable();
  let access = validatedAccess(await licenseCall(env, { action: 'resolve', email: user.email }));
  if (!access.commercial && await isCommercialAccount(env, user)) {
    await licenseCall(env, { action: 'register', email: user.email, source: 'd1_saas_account' });
    access = validatedAccess(await licenseCall(env, { action: 'resolve', email: user.email }));
    if (!access.commercial) throw unavailable();
  }
  return access;
}
