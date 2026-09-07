import { sendPaidConfirmation } from '../_shared/post-payment-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function rest(url: string, serviceKey: string, path: string, options: RequestInit = {}) {
  return fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validCheckoutId(value: string) {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value);
}

function validNonce(value: string) {
  return /^[A-Fa-f0-9]{32,128}$/.test(value);
}

function normalizeEnvironment(value: unknown) {
  const environment = String(value || 'production').toLowerCase();
  return environment === 'sandbox' ? 'sandbox' : 'production';
}

function providerForEnvironment(environment: string) {
  return environment === 'sandbox' ? 'asaas_sandbox' : 'asaas';
}

function sourceForEnvironment(environment: string) {
  return environment === 'sandbox' ? 'cloudflare_asaas_sandbox' : 'cloudflare_asaas';
}

function validCheckoutUrl(value: string, environment: string) {
  try {
    const url = new URL(value);
    const expectedHost = environment === 'sandbox' ? 'sandbox.asaas.com' : 'asaas.com';
    return url.protocol === 'https:'
      && url.hostname === expectedHost
      && url.pathname.startsWith('/checkoutSession/');
  } catch {
    return false;
  }
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchPlan(supabaseUrl: string, serviceKey: string, planCode: string) {
  const planResponse = await rest(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_plan_catalog?plan_code=eq.${encodeURIComponent(planCode)}&active=eq.true&select=plan_code,display_name,billing_interval,price_cents,currency,installment_max&limit=1`,
  );
  const plans = await planResponse.json().catch(() => []);
  const plan = Array.isArray(plans) ? plans[0] : null;
  return { planResponse, plan };
}

async function fetchAccount(supabaseUrl: string, serviceKey: string, ownerId: string) {
  const response = await rest(
    supabaseUrl,
    serviceKey,
    `/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(ownerId)}&select=id,owner_id,status&limit=1`,
  );
  const rows = await response.json().catch(() => []);
  return { response, account: Array.isArray(rows) ? rows[0] || null : null };
}

async function ensurePendingAccount(supabaseUrl: string, serviceKey: string, ownerId: string) {
  const existing = await fetchAccount(supabaseUrl, serviceKey, ownerId);
  if (existing.response.ok && existing.account) return existing.account;

  const createResponse = await rest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/saas_accounts?select=id,owner_id,status',
    {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ owner_id: ownerId, account_type: 'individual', status: 'active' }),
    },
  );
  const createdRows = await createResponse.json().catch(() => []);
  const created = Array.isArray(createdRows) ? createdRows[0] || null : null;
  if (createResponse.ok && created) return created;

  if (createResponse.status === 409) {
    const raced = await fetchAccount(supabaseUrl, serviceKey, ownerId);
    if (raced.response.ok && raced.account) return raced.account;
  }
  return null;
}

async function fetchAdminUser(supabaseUrl: string, serviceKey: string, userId: string) {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    },
  });
  const user = await response.json().catch(() => null);
  return { response, user };
}

// Password verification stays in Supabase Auth (including its rate limits and hooks).
// Auth returns email_not_confirmed only after validating the password.
async function prepareSignup(url: string, key: string, body: Record<string, unknown>) {
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const planCode = String(body.planCode || '');
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) return json(400, { error: 'invalid_plan' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 256) {
    return json(400, { error: 'invalid_signup_fields' });
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  if (!anonKey) return json(503, { error: 'server_not_configured' });
  const login = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const auth = await login.json().catch(() => ({}));
  if (login.ok && auth.access_token) {
    const meta = auth.user?.app_metadata;
    if (meta?.checkout_email_after_payment && validNonce(String(meta.checkout_nonce || ''))) {
      return json(200, { session: auth, userId: auth.user.id, signupNonce: meta.checkout_nonce });
    }
    return json(200, { session: auth });
  }
  if (login.status === 429) return json(429, { error: 'signup_rate_limited' });
  let userId = '';
  if (auth.error_code === 'email_not_confirmed') {
    const lookup = await rest(url, key, '/rest/v1/rpc/commercial_pending_user_id', {
      method: 'POST', body: JSON.stringify({ p_email: email }),
    });
    const id = await lookup.json().catch(() => null);
    if (!lookup.ok) return json(503, { error: 'signup_lookup_unavailable' });
    if (typeof id !== 'string' || !validUuid(id)) return json(400, { error: 'signup_credentials_invalid' });
    userId = id;
  } else if (auth.error_code === 'invalid_credentials') {
    // The admin creation API sends no email and does not confirm the address.
    // It refuses existing emails: never overwrite an existing user's password.
    const created = await rest(url, key, '/auth/v1/admin/users', {
      method: 'POST', body: JSON.stringify({ email, password, email_confirm: false,
        user_metadata: { signup_source: 'commercial_saas', plan_intent: planCode },
        app_metadata: { checkout_email_after_payment: true, checkout_nonce: randomSecret() },
      }),
    });
    const user = await created.json().catch(() => null);
    if (!created.ok || !user?.id) return json(created.status >= 500 ? 503 : 400, { error: 'signup_credentials_invalid' });
    userId = user.id;
  } else {
    // Do not turn CAPTCHA/hook/provider failures into permission to create users.
    return json(login.status || 400, { error: 'signup_auth_unavailable' });
  }
  const { response, user } = await fetchAdminUser(url, key, userId);
  if (!response.ok) return json(503, { error: 'signup_lookup_unavailable' });
  let nonce = user?.app_metadata?.checkout_nonce;
  if (!validNonce(String(nonce || ''))) {
    nonce = randomSecret();
    const updated = await rest(url, key, `/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT', body: JSON.stringify({ app_metadata: {
        ...user.app_metadata, checkout_email_after_payment: true, checkout_nonce: nonce,
      } }),
    });
    if (!updated.ok) return json(503, { error: 'signup_lookup_unavailable' });
  }
  return json(200, { userId, signupNonce: nonce });
}

async function pendingStatus(url: string, key: string, body: Record<string, unknown>) {
  const userId = String(body.userId || '');
  if (!validUuid(userId) || !validNonce(String(body.signupNonce || ''))) return json(401, { error: 'invalid_signup_proof' });
  const { response, user } = await fetchAdminUser(url, key, userId);
  if (!response.ok || user?.app_metadata?.checkout_nonce !== body.signupNonce) return json(401, { error: 'invalid_signup_proof' });
  const result = await sendPaidConfirmation(url, key, userId);
  return json(result.ok ? 200 : 503, result);
}

async function createPendingRequest(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
) {
  const environment = normalizeEnvironment(body?.environment);
  if (environment !== 'production') return json(400, { error: 'pending_checkout_production_only' });

  const userId = String(body?.userId || '');
  const signupNonce = String(body?.signupNonce || '');
  const planCode = String(body?.planCode || '');
  if (!validUuid(userId) || !validNonce(signupNonce)) return json(400, { error: 'invalid_signup_proof' });
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) return json(400, { error: 'invalid_plan' });

  const { response: userResponse, user } = await fetchAdminUser(supabaseUrl, serviceKey, userId);
  if (!userResponse.ok || String(user?.id || '') !== userId) return json(404, { error: 'pending_signup_not_found' });

  const metadata = user?.user_metadata || {};
  const deferred = user?.app_metadata?.checkout_email_after_payment === true;
  if (deferred) {
    if (user.app_metadata.checkout_nonce !== signupNonce) return json(401, { error: 'invalid_signup_proof' });
  } else {
    // Keep already-open legacy checkouts compatible during rollout.
    if (metadata?.signup_source !== 'commercial_saas'
        || metadata?.plan_intent !== planCode || metadata?.signup_nonce !== signupNonce) {
      return json(401, { error: 'invalid_signup_proof' });
    }
    const createdAt = Date.parse(String(user?.created_at || ''));
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > 30 * 60 * 1000) return json(410, { error: 'signup_proof_expired' });
  }

  // Reuse even a legacy pending purchase for this owner, including after a lost response.
  const priorResponse = await rest(supabaseUrl, serviceKey,
    `/rest/v1/billing_checkout_requests?owner_id=eq.${encodeURIComponent(userId)}&provider=eq.asaas&status=in.(pending_provider,checkout_created,paid)&select=id,status,plan_code,checkout_url&order=created_at.desc&limit=1`);
  const priorRows = await priorResponse.json().catch(() => []);
  if (!priorResponse.ok) return json(503, { error: 'checkout_lookup_failed' });
  const prior = priorRows[0];
  if (prior?.status === 'paid') return json(200, { status: 'paid' });
  if (prior) {
    if (prior.plan_code !== planCode) return json(409, { error: 'pending_checkout_other_plan' });
    if (prior.status === 'checkout_created' && validCheckoutUrl(prior.checkout_url, environment)) {
      return json(200, { status: 'checkout_created', checkoutUrl: prior.checkout_url, requestId: prior.id });
    }
    return json(409, { error: 'checkout_in_progress' });
  }

  const { planResponse, plan } = await fetchPlan(supabaseUrl, serviceKey, planCode);
  if (!planResponse.ok || !plan) return json(404, { error: 'plan_not_available' });

  const account = await ensurePendingAccount(supabaseUrl, serviceKey, userId);
  if (!account) return json(500, { error: 'pending_account_failed' });

  const requestSecret = randomSecret();
  const requestSecretHash = await sha256Hex(requestSecret);
  const provider = providerForEnvironment(environment);
  const source = sourceForEnvironment(environment);

  const insertResponse = await rest(
    supabaseUrl,
    serviceKey,
    '/rest/v1/billing_checkout_requests?select=id,plan_code,status,provider,created_at',
    {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        account_id: account.id,
        owner_id: userId,
        plan_code: planCode,
        provider,
        status: 'pending_provider',
        metadata: {
          source,
          environment,
          signup_flow: deferred ? 'deferred_email_v2' : 'pre_email_confirmation',
          request_secret_hash: requestSecretHash,
        },
      }),
    },
  );
  const requests = await insertResponse.json().catch(() => []);
  const checkoutRequest = Array.isArray(requests) ? requests[0] : null;
  if (insertResponse.status === 409) return json(409, { error: 'checkout_in_progress' });
  if (!insertResponse.ok || !checkoutRequest) return json(500, { error: 'checkout_request_failed' });

  return json(200, {
    status: 'pending_provider',
    requestId: checkoutRequest.id,
    requestSecret,
    plan,
    environment,
  });
}

async function updatePendingRequest(
  supabaseUrl: string,
  serviceKey: string,
  body: Record<string, unknown>,
  action: string,
) {
  const environment = normalizeEnvironment(body?.environment);
  if (environment !== 'production') return json(400, { error: 'pending_checkout_production_only' });

  const requestId = String(body?.requestId || '');
  const requestSecret = String(body?.requestSecret || '');
  if (!validUuid(requestId) || !/^[A-Fa-f0-9]{64}$/.test(requestSecret)) {
    return json(400, { error: 'invalid_pending_request_proof' });
  }

  const provider = providerForEnvironment(environment);
  const lookupResponse = await rest(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}&select=id,owner_id,plan_code,status,provider,metadata&limit=1`,
  );
  const lookupRows = await lookupResponse.json().catch(() => []);
  const checkoutRequest = Array.isArray(lookupRows) ? lookupRows[0] : null;
  if (!lookupResponse.ok || !checkoutRequest) return json(404, { error: 'checkout_request_not_found' });

  const expectedHash = String(checkoutRequest?.metadata?.request_secret_hash || '');
  const suppliedHash = await sha256Hex(requestSecret);
  if (!expectedHash || suppliedHash !== expectedHash) return json(401, { error: 'invalid_pending_request_proof' });
  if (checkoutRequest.status !== 'pending_provider') return json(409, { error: 'pending_request_already_finalized' });

  if (action === 'mark_pending_failed') {
    const failedResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'failed',
          metadata: { ...checkoutRequest.metadata, request_secret_hash: null, failed_by: 'preauth_worker' },
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!failedResponse.ok) return json(500, { error: 'checkout_request_update_failed' });
    return json(200, { status: 'failed', requestId, environment });
  }

  if (action === 'attach_pending_provider_checkout') {
    const externalCheckoutId = String(body?.externalCheckoutId || '');
    const checkoutUrl = String(body?.checkoutUrl || '');
    if (!validCheckoutId(externalCheckoutId) || !validCheckoutUrl(checkoutUrl, environment)) {
      return json(400, { error: 'invalid_provider_checkout' });
    }

    const updateResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}&select=id,status,external_checkout_id`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          status: 'checkout_created',
          external_checkout_id: externalCheckoutId,
          checkout_url: checkoutUrl,
          metadata: {
            ...checkoutRequest.metadata,
            request_secret_hash: null,
            linked: true,
            linked_by: 'preauth_worker',
          },
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const updatedRows = await updateResponse.json().catch(() => []);
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updateResponse.ok || !updated) return json(500, { error: 'checkout_request_update_failed' });
    return json(200, { status: 'checkout_created', requestId, externalCheckoutId, environment });
  }

  return json(400, { error: 'invalid_action' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json(503, { error: 'server_not_configured' });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || 'create_request');

  if (action === 'prepare_signup') return prepareSignup(supabaseUrl, serviceKey, body);
  if (action === 'pending_status') return pendingStatus(supabaseUrl, serviceKey, body);

  if (action === 'create_pending_request') {
    return createPendingRequest(supabaseUrl, serviceKey, body);
  }
  if (action === 'attach_pending_provider_checkout' || action === 'mark_pending_failed') {
    return updatePendingRequest(supabaseUrl, serviceKey, body, action);
  }

  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'authentication_required' });

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json(401, { error: 'invalid_session' });
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return json(401, { error: 'invalid_session' });

  const environment = normalizeEnvironment(body?.environment);
  const provider = providerForEnvironment(environment);
  const source = sourceForEnvironment(environment);

  if (action === 'create_request') {
    const planCode = String(body?.planCode || '');
    if (!['pro_monthly', 'pro_annual'].includes(planCode)) {
      return json(400, { error: 'invalid_plan' });
    }

    const { planResponse, plan } = await fetchPlan(supabaseUrl, serviceKey, planCode);
    if (!planResponse.ok || !plan) return json(404, { error: 'plan_not_available' });

    const accountResponse = await fetchAccount(supabaseUrl, serviceKey, user.id);
    if (!accountResponse.response.ok || !accountResponse.account) return json(409, { error: 'onboarding_required' });

    const insertResponse = await rest(
      supabaseUrl,
      serviceKey,
      '/rest/v1/billing_checkout_requests?select=id,plan_code,status,provider,created_at',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          account_id: accountResponse.account.id,
          owner_id: user.id,
          plan_code: planCode,
          provider,
          status: 'pending_provider',
          metadata: { source, environment },
        }),
      },
    );
    const requests = await insertResponse.json().catch(() => []);
    const checkoutRequest = Array.isArray(requests) ? requests[0] : null;
    if (!insertResponse.ok || !checkoutRequest) return json(500, { error: 'checkout_request_failed' });

    return json(200, {
      status: 'pending_provider',
      requestId: checkoutRequest.id,
      plan,
      environment,
    });
  }

  const requestId = String(body?.requestId || '');
  if (!validUuid(requestId)) return json(400, { error: 'invalid_request_id' });

  const ownRequestResponse = await rest(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id,owner_id,plan_code,status,provider&limit=1`,
  );
  const ownRequests = await ownRequestResponse.json().catch(() => []);
  const ownRequest = Array.isArray(ownRequests) ? ownRequests[0] : null;
  if (!ownRequestResponse.ok || !ownRequest) return json(404, { error: 'checkout_request_not_found' });
  if (ownRequest.provider !== provider) return json(409, { error: 'checkout_environment_mismatch' });

  if (action === 'mark_failed') {
    const failedResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&owner_id=eq.${encodeURIComponent(user.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', updated_at: new Date().toISOString() }),
      },
    );
    if (!failedResponse.ok) return json(500, { error: 'checkout_request_update_failed' });
    return json(200, { status: 'failed', requestId, environment });
  }

  if (action === 'attach_provider_checkout') {
    const externalCheckoutId = String(body?.externalCheckoutId || '');
    const checkoutUrl = String(body?.checkoutUrl || '');
    if (!validCheckoutId(externalCheckoutId) || !validCheckoutUrl(checkoutUrl, environment)) {
      return json(400, { error: 'invalid_provider_checkout' });
    }

    const updateResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&owner_id=eq.${encodeURIComponent(user.id)}&select=id,status,external_checkout_id`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          provider,
          status: 'checkout_created',
          external_checkout_id: externalCheckoutId,
          checkout_url: checkoutUrl,
          metadata: { source, environment, linked: true },
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const updatedRows = await updateResponse.json().catch(() => []);
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updateResponse.ok || !updated) return json(500, { error: 'checkout_request_update_failed' });
    return json(200, { status: 'checkout_created', requestId, externalCheckoutId, environment });
  }

  return json(400, { error: 'invalid_action' });
});
