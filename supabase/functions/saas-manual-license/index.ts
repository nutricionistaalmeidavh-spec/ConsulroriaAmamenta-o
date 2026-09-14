import { addMonthsUtc, MANUAL_PLAN_CODE, MANUAL_PLAN_MONTHS, manualGrantState, normalizeEmail } from './license-policy.mjs';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-artisys-license-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const manualBilling = { provider: 'manual_marketplace' } as const;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function digest(value: string) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

async function sameSecret(actual: string, expected: string) {
  if (!actual || !expected) return false;
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) mismatch |= (a[i] || 0) ^ (b[i] || 0);
  return mismatch === 0;
}

function serviceHeaders(serviceKey: string, body = false) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function rest(url: string, serviceKey: string, path: string, options: RequestInit = {}) {
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      ...serviceHeaders(serviceKey, Boolean(options.body)),
      ...(options.headers || {}),
    },
  });
}

async function rpc(url: string, serviceKey: string, name: string, body: Record<string, unknown>) {
  const response = await rest(url, serviceKey, `/rest/v1/rpc/${name}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `RPC ${name} failed (${response.status})`);
  return payload;
}

type GrantRow = {
  id: string;
  email: string;
  plan_code: string;
  status: 'active' | 'revoked';
  starts_at: string;
  expires_at: string;
  source: string;
  granted_by: string;
};

async function findGrant(url: string, serviceKey: string, email: string) {
  const response = await rest(
    url,
    serviceKey,
    `/rest/v1/manual_license_grants?email=eq.${encodeURIComponent(email)}&select=id,email,plan_code,status,starts_at,expires_at,source,granted_by&limit=1`,
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`manual grant lookup failed (${response.status})`);
  return (Array.isArray(rows) ? rows[0] : null) as GrantRow | null;
}

async function saveGrant(url: string, serviceKey: string, row: Record<string, unknown>) {
  const response = await rest(
    url,
    serviceKey,
    '/rest/v1/manual_license_grants?on_conflict=email&select=id,email,plan_code,status,starts_at,expires_at,source,granted_by',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(row),
    },
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(rows?.message || `manual grant save failed (${response.status})`);
  return (Array.isArray(rows) ? rows[0] : null) as GrantRow | null;
}

async function findUserByEmail(url: string, serviceKey: string, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      headers: serviceHeaders(serviceKey),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`auth user lookup failed (${response.status})`);
    const users = Array.isArray(payload?.users) ? payload.users : [];
    const found = users.find((user: { email?: string }) => normalizeEmail(user?.email) === email);
    if (found) return found as { id: string; email: string };
    if (users.length < 200) return null;
  }
  return null;
}

async function hasSaasAccount(url: string, serviceKey: string, ownerId: string) {
  const response = await rest(
    url,
    serviceKey,
    `/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(ownerId)}&select=id&limit=1`,
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`SaaS account lookup failed (${response.status})`);
  return Array.isArray(rows) && rows.length > 0;
}

async function subscription(url: string, serviceKey: string, ownerId: string) {
  const response = await rest(
    url,
    serviceKey,
    `/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&select=plan_code,status,current_period_end,provider&limit=1`,
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error(`subscription lookup failed (${response.status})`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function activateIfPossible(url: string, serviceKey: string, grant: GrantRow) {
  const user = await findUserByEmail(url, serviceKey, grant.email);
  if (!user) return { activation: 'pending_user' };
  if (!await hasSaasAccount(url, serviceKey, user.id)) return { activation: 'pending_account', ownerId: user.id };

  await rpc(url, serviceKey, 'apply_billing_state', {
    p_owner_id: user.id,
    p_plan_code: MANUAL_PLAN_CODE,
    p_status: 'active',
    p_provider: manualBilling.provider,
    p_external_subscription_id: grant.id,
    p_current_period_end: grant.expires_at,
    p_metadata: { source: grant.source, grant_id: grant.id },
  });
  return { activation: 'active', ownerId: user.id };
}

async function grant(url: string, serviceKey: string, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'invalid_email' });
  if (body.planCode && body.planCode !== MANUAL_PLAN_CODE) return json(400, { error: 'invalid_plan' });
  if (body.months && Number(body.months) !== MANUAL_PLAN_MONTHS) return json(400, { error: 'invalid_period' });

  const existing = await findGrant(url, serviceKey, email);
  const now = new Date().toISOString();
  const existingState = manualGrantState(existing ? { status: existing.status, expiresAt: existing.expires_at } : null, now);
  const base = existingState === 'active' ? existing!.expires_at : now;
  const startsAt = existingState === 'active' ? existing!.starts_at : now;
  const expiresAt = addMonthsUtc(base, MANUAL_PLAN_MONTHS);
  const source = String(body.source || 'mercado_livre_manual').slice(0, 80);
  const grantedBy = String(body.actor || '').slice(0, 160);

  const saved = await saveGrant(url, serviceKey, {
    email,
    plan_code: MANUAL_PLAN_CODE,
    status: 'active',
    starts_at: startsAt,
    expires_at: expiresAt,
    source,
    granted_by: grantedBy,
    metadata: { channel: 'central_artisys', last_granted_at: now },
    updated_at: now,
  });
  if (!saved) throw new Error('manual grant was not persisted');
  const activation = await activateIfPossible(url, serviceKey, saved);
  return json(200, { ok: true, grant: saved, ...activation });
}

async function revoke(url: string, serviceKey: string, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'invalid_email' });
  const existing = await findGrant(url, serviceKey, email);
  if (!existing) return json(404, { error: 'grant_not_found' });

  const saved = await saveGrant(url, serviceKey, {
    ...existing,
    status: 'revoked',
    updated_at: new Date().toISOString(),
  });
  const user = await findUserByEmail(url, serviceKey, email);
  if (user && await hasSaasAccount(url, serviceKey, user.id)) {
    const current = await subscription(url, serviceKey, user.id);
    if (current?.plan_code === MANUAL_PLAN_CODE && current?.provider === manualBilling.provider) {
      await rpc(url, serviceKey, 'apply_billing_state', {
        p_owner_id: user.id,
        p_plan_code: 'freemium',
        p_status: 'inactive',
        p_provider: manualBilling.provider,
        p_external_subscription_id: existing.id,
        p_current_period_end: null,
        p_metadata: { source: existing.source, manual_grant_status: 'revoked' },
      });
    }
  }
  return json(200, { ok: true, grant: saved, activation: 'revoked' });
}

async function status(url: string, serviceKey: string, body: Record<string, unknown>) {
  const email = normalizeEmail(body.email);
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: 'invalid_email' });
  const existing = await findGrant(url, serviceKey, email);
  if (!existing) return json(200, { ok: true, state: 'none', grant: null });
  return json(200, {
    ok: true,
    state: manualGrantState({ status: existing.status, expiresAt: existing.expires_at }),
    grant: existing,
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const expected = Deno.env.get('LICENSE_ADMIN_SECRET') || '';
  const actual = request.headers.get('x-artisys-license-secret') || '';
  if (!await sameSecret(actual, expected)) return json(401, { error: 'unauthorized' });

  const url = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !serviceKey) return json(503, { error: 'service_unavailable' });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || 'status');
  try {
    if (action === 'grant') return await grant(url, serviceKey, body);
    if (action === 'revoke') return await revoke(url, serviceKey, body);
    if (action === 'status') return await status(url, serviceKey, body);
    return json(400, { error: 'invalid_action' });
  } catch (error) {
    console.error('manual-license', error instanceof Error ? error.message : String(error));
    return json(500, { error: 'manual_license_failed' });
  }
});
