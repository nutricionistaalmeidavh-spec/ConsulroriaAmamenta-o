const SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_CHECKOUT_URL = 'https://asaas.com/checkoutSession/show?id=';

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

function tomorrowAsaasDateTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)} 12:00:00`;
}

function externalReference(ownerId, planCode) {
  return `saas:${ownerId}:${planCode}`;
}

function parseExternalReference(value) {
  const match = String(value || '').match(/^saas:([0-9a-f-]{36}):(pro_monthly|pro_annual)$/i);
  if (!match) return null;
  return { ownerId: match[1], planCode: match[2].toLowerCase() };
}

function checkoutPayload(planCode, ownerId, origin) {
  const callback = {
    successUrl: `${origin}/comercial/plano.html?asaas=success`,
    cancelUrl: `${origin}/comercial/plano.html?asaas=cancel`,
    expiredUrl: `${origin}/comercial/plano.html?asaas=expired`,
  };

  const common = {
    billingTypes: ['CREDIT_CARD'],
    minutesToExpire: 60,
    externalReference: externalReference(ownerId, planCode),
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

async function asaasFetch(env, path, options = {}) {
  if (!env.ASSAS_SECRET) return { response: null, payload: null };
  const response = await fetch(`${ASAAS_API_URL}${path}`, {
    ...options,
    headers: {
      access_token: env.ASSAS_SECRET,
      accept: 'application/json',
      'user-agent': 'ConsultoriaAmamentacao/1.0',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function createCheckout(request, env) {
  if (!env.ASSAS_SECRET) return json(503, { error: 'asaas_not_configured' });

  const user = await authenticateUser(request);
  if (!user) return json(401, { error: 'unauthorized' });

  const input = await request.json().catch(() => null);
  const planCode = String(input?.planCode || '');
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) {
    return json(400, { error: 'invalid_plan' });
  }

  const url = new URL(request.url);
  const payload = checkoutPayload(planCode, user.id, url.origin);
  const { response, payload: result } = await asaasFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  if (!response) return json(503, { error: 'asaas_not_configured' });
  if (!response.ok || !result?.id) {
    return json(response.status || 502, {
      error: 'asaas_checkout_failed',
      details: Array.isArray(result?.errors)
        ? result.errors.map((item) => ({ code: item.code, description: item.description }))
        : undefined,
    });
  }

  return json(200, {
    checkoutId: result.id,
    checkoutUrl: result.link || `${ASAAS_CHECKOUT_URL}${encodeURIComponent(result.id)}`,
    planCode,
  });
}

function verifiedBillingTransition(status) {
  const normalized = String(status || '').toUpperCase();
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(normalized)) return 'active';
  if (normalized === 'OVERDUE') return 'past_due';
  if ([
    'REFUNDED',
    'REFUND_REQUESTED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
  ].includes(normalized)) return 'cancelled';
  return null;
}

async function callBillingBridge(env, paymentId) {
  return fetch(`${SUPABASE_URL}/functions/v1/saas-billing-webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-asaas-api-key': env.ASSAS_SECRET,
      'x-billing-source': 'cloudflare-asaas',
    },
    body: JSON.stringify({ paymentId }),
  });
}

async function handleWebhook(request, env) {
  if (!env.ASSAS_SECRET) return json(503, { error: 'asaas_not_configured' });

  // The webhook is only a trigger. Cloudflare never trusts the event status or
  // external reference to change SaaS access; it re-reads the payment at Asaas.
  const payload = await request.json().catch(() => null);
  const paymentId = String(payload?.payment?.id || '');
  if (!paymentId) return json(200, { status: 'ignored_without_payment' });
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(paymentId)) {
    return json(400, { error: 'invalid_payment_id' });
  }

  const { response: asaasResponse, payload: verifiedPayment } = await asaasFetch(
    env,
    `/payments/${encodeURIComponent(paymentId)}`,
    { method: 'GET' },
  );

  if (!asaasResponse) return json(503, { error: 'asaas_not_configured' });
  if (asaasResponse.status === 404) return json(200, { status: 'ignored_payment_not_found' });
  if (!asaasResponse.ok || !verifiedPayment?.id) {
    return json(502, { error: 'asaas_payment_verification_failed' });
  }
  if (String(verifiedPayment.id) !== paymentId) {
    return json(502, { error: 'asaas_payment_identity_mismatch' });
  }

  const mapped = parseExternalReference(verifiedPayment?.externalReference);
  if (!mapped) return json(200, { status: 'ignored_unmapped_verified_payment', paymentId });

  const paymentStatus = String(verifiedPayment?.status || '').toUpperCase();
  const transition = verifiedBillingTransition(paymentStatus);
  if (!transition) {
    return json(200, { status: 'ignored_no_billing_transition', paymentId, paymentStatus });
  }

  // Supabase owns the administrative database credential. Cloudflare sends only
  // the existing Asaas key over TLS; the Edge Function validates the request and
  // independently re-reads the payment before changing access.
  const bridgeResponse = await callBillingBridge(env, paymentId);
  const bridgePayload = await bridgeResponse.json().catch(() => null);
  if (!bridgeResponse.ok) {
    return json(bridgeResponse.status || 502, {
      error: 'billing_bridge_failed',
      details: bridgePayload?.error || undefined,
    });
  }

  return json(200, bridgePayload || {
    status: 'processed',
    paymentId,
    planCode: mapped.planCode,
    paymentStatus,
  });
}

function health(env) {
  return json(200, {
    ok: true,
    service: 'commercial-asaas-api',
    asaasApiConfigured: Boolean(env.ASSAS_SECRET),
    webhookVerification: 'asaas_api_lookup',
    billingBridge: 'supabase_edge_function',
    cloudflareSecretsRequired: ['ASSAS_SECRET'],
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/asaas/health' && request.method === 'GET') return health(env);
    if (url.pathname === '/api/asaas/checkout' && request.method === 'POST') return createCheckout(request, env);
    if (url.pathname === '/api/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env);

    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
