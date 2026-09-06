const SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_SANDBOX_API_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_CHECKOUT_URL = 'https://asaas.com/checkoutSession/show?id=';
const ASAAS_SANDBOX_CHECKOUT_URL = 'https://sandbox.asaas.com/checkoutSession/show/';

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

async function authenticateUser(request) {
  const token = bearerToken(request);
  if (!token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

async function callCheckoutRegistry(request, body) {
  const token = bearerToken(request);
  if (!token) return { response: null, payload: null };
  const response = await fetch(`${SUPABASE_URL}/functions/v1/saas-checkout`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function asaasConfig(env, environment = 'production') {
  if (environment === 'sandbox') {
    return {
      environment: 'sandbox',
      secret: env.ASSAS_SANDBOX_SECRET,
      apiUrl: ASAAS_SANDBOX_API_URL,
      checkoutFallback: ASAAS_SANDBOX_CHECKOUT_URL,
      provider: 'asaas_sandbox',
      billingSource: 'cloudflare-asaas-sandbox',
    };
  }

  return {
    environment: 'production',
    secret: env.ASSAS_SECRET,
    apiUrl: ASAAS_API_URL,
    checkoutFallback: ASAAS_CHECKOUT_URL,
    provider: 'asaas',
    billingSource: 'cloudflare-asaas',
  };
}

function tomorrowAsaasDateTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)} 12:00:00`;
}

function checkoutPayload(planCode, requestId, origin, environment = 'production') {
  const suffix = environment === 'sandbox' ? '&environment=sandbox' : '';
  const callback = {
    successUrl: `${origin}/comercial/plano.html?asaas=success${suffix}`,
    cancelUrl: `${origin}/comercial/plano.html?asaas=cancel${suffix}`,
    expiredUrl: `${origin}/comercial/plano.html?asaas=expired${suffix}`,
  };

  const common = {
    billingTypes: ['CREDIT_CARD'],
    minutesToExpire: 60,
    externalReference: `saas_checkout:${requestId}`,
    callback,
  };

  if (planCode === 'pro_monthly') {
    return {
      ...common,
      chargeTypes: ['RECURRENT'],
      items: [{
        name: 'Plano Pro mensal',
        description: 'Uso ilimitado e upload de fotos e vídeos',
        quantity: 1,
        value: 49.9,
      }],
      subscription: {
        cycle: 'MONTHLY',
        nextDueDate: tomorrowAsaasDateTime(),
      },
    };
  }

  return {
    ...common,
    chargeTypes: ['DETACHED', 'INSTALLMENT'],
    items: [{
      name: 'Plano Pro anual',
      description: 'Plano anual com uso ilimitado e upload de fotos e vídeos',
      quantity: 1,
      value: 499,
    }],
    installment: { maxInstallmentCount: 12 },
  };
}

async function asaasFetch(env, path, options = {}, environment = 'production') {
  const config = asaasConfig(env, environment);
  if (!config.secret) return { response: null, payload: null };
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      access_token: config.secret,
      accept: 'application/json',
      'user-agent': `ConsultoriaAmamentacao/1.0 (${config.environment})`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function checkoutUrlFromResult(result, environment) {
  if (result?.link) return result.link;
  const config = environment === 'sandbox'
    ? { prefix: ASAAS_SANDBOX_CHECKOUT_URL, suffix: '' }
    : { prefix: ASAAS_CHECKOUT_URL, suffix: '' };
  return `${config.prefix}${encodeURIComponent(result.id)}${config.suffix}`;
}

async function createCheckout(request, env, environment = 'production') {
  const config = asaasConfig(env, environment);
  if (!config.secret) {
    return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });
  }

  const user = await authenticateUser(request);
  if (!user) return json(401, { error: 'unauthorized' });

  const input = await request.json().catch(() => null);
  const planCode = String(input?.planCode || '');
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) {
    return json(400, { error: 'invalid_plan' });
  }

  const registered = await callCheckoutRegistry(request, {
    action: 'create_request',
    planCode,
    environment,
  });
  if (!registered.response?.ok || !registered.payload?.requestId) {
    return json(registered.response?.status || 502, {
      error: registered.payload?.error || 'checkout_registry_failed',
    });
  }
  const requestId = String(registered.payload.requestId);

  const url = new URL(request.url);
  const providerPayload = checkoutPayload(planCode, requestId, url.origin, environment);
  const { response, payload: result } = await asaasFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify(providerPayload),
  }, environment);

  if (!response) {
    return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });
  }
  if (!response.ok || !result?.id) {
    await callCheckoutRegistry(request, { action: 'mark_failed', requestId, environment });
    return json(response.status || 502, {
      error: 'asaas_checkout_failed',
      details: Array.isArray(result?.errors)
        ? result.errors.map((item) => ({ code: item.code, description: item.description }))
        : undefined,
    });
  }

  const checkoutUrl = checkoutUrlFromResult(result, environment);
  const attached = await callCheckoutRegistry(request, {
    action: 'attach_provider_checkout',
    requestId,
    externalCheckoutId: result.id,
    checkoutUrl,
    environment,
  });

  if (!attached.response?.ok) {
    await asaasFetch(env, `/checkouts/${encodeURIComponent(result.id)}/cancel`, { method: 'POST' }, environment);
    return json(502, { error: 'checkout_registry_attach_failed' });
  }

  return json(200, {
    checkoutId: result.id,
    checkoutUrl,
    planCode,
    environment,
  });
}

async function callBillingBridge(env, paymentId, environment = 'production') {
  const config = asaasConfig(env, environment);
  return fetch(`${SUPABASE_URL}/functions/v1/saas-billing-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-asaas-api-key': config.secret,
      'x-billing-source': config.billingSource,
    },
    body: JSON.stringify({ paymentId }),
  });
}

async function handleWebhook(request, env, environment = 'production') {
  const config = asaasConfig(env, environment);
  if (!config.secret) {
    return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });
  }

  const payload = await request.json().catch(() => null);
  const paymentId = String(payload?.payment?.id || '');
  if (!paymentId) return json(200, { status: 'ignored_without_payment', environment });
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(paymentId)) {
    return json(400, { error: 'invalid_payment_id' });
  }

  // Never trust status/externalReference from the webhook itself.
  const { response: asaasResponse, payload: verifiedPayment } = await asaasFetch(
    env,
    `/payments/${encodeURIComponent(paymentId)}`,
    { method: 'GET' },
    environment,
  );
  if (!asaasResponse) {
    return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });
  }
  if (asaasResponse.status === 404) return json(200, { status: 'ignored_payment_not_found', environment });
  if (!asaasResponse.ok || String(verifiedPayment?.id || '') !== paymentId) {
    return json(502, { error: 'asaas_payment_verification_failed' });
  }

  // Supabase owns its service-role credential. It independently verifies that
  // this payment belongs to the stored checkout session before changing access.
  const bridgeResponse = await callBillingBridge(env, paymentId, environment);
  const bridgePayload = await bridgeResponse.json().catch(() => null);
  if (!bridgeResponse.ok) {
    return json(bridgeResponse.status || 502, {
      error: 'billing_bridge_failed',
      details: bridgePayload?.error || undefined,
    });
  }

  return json(200, bridgePayload || { status: 'processed', paymentId, environment });
}

function health(env, environment = 'production') {
  const config = asaasConfig(env, environment);
  return json(200, {
    ok: true,
    service: 'commercial-asaas-api',
    environment,
    asaasApiConfigured: Boolean(config.secret),
    webhookVerification: 'asaas_api_lookup_and_checkout_reconciliation',
    billingBridge: 'supabase_edge_function',
    cloudflareSecretsRequired: [environment === 'sandbox' ? 'ASSAS_SANDBOX_SECRET' : 'ASSAS_SECRET'],
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/asaas/health' && request.method === 'GET') return health(env, 'production');
    if (url.pathname === '/api/asaas/checkout' && request.method === 'POST') return createCheckout(request, env, 'production');
    if (url.pathname === '/api/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'production');

    if (url.pathname === '/api/sandbox/asaas/health' && request.method === 'GET') return health(env, 'sandbox');
    if (url.pathname === '/api/sandbox/asaas/checkout' && request.method === 'POST') return createCheckout(request, env, 'sandbox');
    if (url.pathname === '/api/sandbox/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'sandbox');

    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
