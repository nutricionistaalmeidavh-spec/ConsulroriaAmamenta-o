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
  const user = await userResponse.json();
  if (!user?.id) return json(401, { error: 'invalid_session' });

  const body = await req.json().catch(() => ({}));
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

  const provider = Deno.env.get('BILLING_PROVIDER') || '';
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
        provider,
        status: 'pending_provider',
        metadata: {
          source: 'commercial_my_plan',
          provider_configured: Boolean(provider),
        },
      }),
    },
  );
  const requests = await insertResponse.json().catch(() => []);
  const checkoutRequest = Array.isArray(requests) ? requests[0] : null;
  if (!insertResponse.ok || !checkoutRequest) return json(500, { error: 'checkout_request_failed' });

  if (!provider) {
    return json(200, {
      status: 'pending_provider',
      providerConfigured: false,
      requestId: checkoutRequest.id,
      plan,
      message: 'Checkout request stored safely; payment provider is not configured yet.',
    });
  }

  return json(501, {
    status: 'adapter_not_configured',
    providerConfigured: true,
    requestId: checkoutRequest.id,
    provider,
    plan,
    message: 'Provider selected, but its checkout adapter has not been implemented yet.',
  });
});
