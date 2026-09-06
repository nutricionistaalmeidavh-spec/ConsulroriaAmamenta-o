const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

function validCheckoutUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'asaas.com'
      && url.pathname.startsWith('/checkoutSession/');
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authorization = req.headers.get('Authorization') || '';
  if (!supabaseUrl || !serviceKey) return json(503, { error: 'server_not_configured' });
  if (!authorization.startsWith('Bearer ')) return json(401, { error: 'authentication_required' });

  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: authorization },
  });
  if (!userResponse.ok) return json(401, { error: 'invalid_session' });
  const user = await userResponse.json().catch(() => null);
  if (!user?.id) return json(401, { error: 'invalid_session' });

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || 'create_request');

  if (action === 'create_request') {
    const planCode = String(body?.planCode || '');
    if (!['pro_monthly', 'pro_annual'].includes(planCode)) {
      return json(400, { error: 'invalid_plan' });
    }

    const planResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_plan_catalog?plan_code=eq.${encodeURIComponent(planCode)}&active=eq.true&select=plan_code,display_name,billing_interval,price_cents,currency,installment_max&limit=1`,
    );
    const plans = await planResponse.json().catch(() => []);
    const plan = Array.isArray(plans) ? plans[0] : null;
    if (!planResponse.ok || !plan) return json(404, { error: 'plan_not_available' });

    const accountResponse = await rest(
      supabaseUrl,
      serviceKey,
      `/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(user.id)}&select=id,owner_id,status&limit=1`,
    );
    const accounts = await accountResponse.json().catch(() => []);
    const account = Array.isArray(accounts) ? accounts[0] : null;
    if (!accountResponse.ok || !account) return json(409, { error: 'onboarding_required' });

    const insertResponse = await rest(
      supabaseUrl,
      serviceKey,
      '/rest/v1/billing_checkout_requests?select=id,plan_code,status,provider,created_at',
      {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          account_id: account.id,
          owner_id: user.id,
          plan_code: planCode,
          provider: 'asaas',
          status: 'pending_provider',
          metadata: { source: 'cloudflare_asaas' },
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
    return json(200, { status: 'failed', requestId });
  }

  if (action === 'attach_provider_checkout') {
    const externalCheckoutId = String(body?.externalCheckoutId || '');
    const checkoutUrl = String(body?.checkoutUrl || '');
    if (!validCheckoutId(externalCheckoutId) || !validCheckoutUrl(checkoutUrl)) {
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
          provider: 'asaas',
          status: 'checkout_created',
          external_checkout_id: externalCheckoutId,
          checkout_url: checkoutUrl,
          metadata: { source: 'cloudflare_asaas', linked: true },
          updated_at: new Date().toISOString(),
        }),
      },
    );
    const updatedRows = await updateResponse.json().catch(() => []);
    const updated = Array.isArray(updatedRows) ? updatedRows[0] : null;
    if (!updateResponse.ok || !updated) return json(500, { error: 'checkout_request_update_failed' });
    return json(200, { status: 'checkout_created', requestId, externalCheckoutId });
  }

  return json(400, { error: 'invalid_action' });
});
