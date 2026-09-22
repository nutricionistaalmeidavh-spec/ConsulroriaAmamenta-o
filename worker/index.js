import { handlePartnerAdminRequest, PARTNER_ADMIN_EMAILS_CONFIG } from './partner-admin.js';

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

async function licensingRequest(env, body) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) {
    return { response: null, payload: null, error: 'licensing_not_configured' };
  }
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET,
    },
    body: JSON.stringify(body),
  }));
  const payload = await response.json().catch(() => null);
  return { response, payload, error: null };
}

async function resolveLicense(env, email) {
  const result = await licensingRequest(env, { action: 'resolve', productCode: 'debora-lactacao', email });
  if (!result.response?.ok || !result.payload) throw new Error(result.error || result.payload?.error || 'licensing_unavailable');
  return result.payload;
}

async function registerCommercial(env, email, source = 'saas_onboarding') {
  const result = await licensingRequest(env, { action: 'register', productCode: 'debora-lactacao', email, source });
  if (!result.response?.ok) throw new Error(result.error || result.payload?.error || 'licensing_registration_failed');
  return result.payload;
}

async function syncCommercialLicense(env, input) {
  const result = await licensingRequest(env, { action: 'sync', productCode: 'debora-lactacao', ...input });
  if (!result.response?.ok) throw new Error(result.error || result.payload?.error || 'licensing_sync_failed');
  return result.payload;
}

async function serviceFetch(env, path, options = {}) {
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) return { response: null, payload: null };
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      accept: 'application/json',
      ...(options.body && !(options.body instanceof ReadableStream) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json().catch(() => null) : await response.text().catch(() => '');
  return { response, payload };
}

async function authUserById(env, userId) {
  const { response, payload } = await serviceFetch(env, `/auth/v1/admin/users/${encodeURIComponent(userId)}`);
  return response?.ok && payload?.email ? payload : null;
}

async function handleLicenseMe(request, env) {
  const user = await authenticateUser(request);
  if (!user?.email) return json(401, { error: 'unauthorized' });
  try { return json(200, await resolveLicense(env, user.email)); }
  catch (error) { return json(503, { error: error?.message || 'licensing_unavailable' }); }
}

async function handleCommercialRegistration(request, env) {
  const user = await authenticateUser(request);
  if (!user?.email) return json(401, { error: 'unauthorized' });
  try {
    await registerCommercial(env, user.email, 'saas_onboarding');
    return json(200, await resolveLicense(env, user.email));
  } catch (error) { return json(503, { error: error?.message || 'licensing_registration_failed' }); }
}

async function handleMotherCreate(request, env) {
  const user = await authenticateUser(request);
  if (!user?.id || !user?.email) return json(401, { error: 'unauthorized' });
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return json(503, { error: 'clinical_proxy_not_configured' });
  let access;
  try { access = await resolveLicense(env, user.email); }
  catch (error) { return json(503, { error: error?.message || 'licensing_unavailable' }); }

  if (access.commercial && Number.isInteger(access.patientLimit)) {
    const { response, payload } = await serviceFetch(env, `/rest/v1/mothers?owner_id=eq.${encodeURIComponent(user.id)}&select=id&limit=${Number(access.patientLimit) + 1}`);
    if (!response?.ok) return json(502, { error: 'patient_count_failed' });
    if (Array.isArray(payload) && payload.length >= Number(access.patientLimit)) return json(403, { error: 'SAAS_PATIENT_LIMIT_REACHED', limit: access.patientLimit });
  }

  const input = await request.json().catch(() => null);
  if (!input || typeof input !== 'object') return json(400, { error: 'invalid_patient_payload' });
  const { response, payload } = await serviceFetch(env, '/rest/v1/mothers?select=*', {
    method: 'POST',
    headers: { Prefer: 'return=representation', 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, owner_id: user.id }),
  });
  if (!response) return json(503, { error: 'clinical_proxy_not_configured' });
  if (!response.ok) return json(response.status, { error: payload?.message || payload?.error || 'patient_create_failed' });
  return json(200, payload);
}

async function handleClinicalMediaUpload(request, env) {
  const user = await authenticateUser(request);
  if (!user?.id || !user?.email) return json(401, { error: 'unauthorized' });
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!serviceKey) return json(503, { error: 'clinical_proxy_not_configured' });
  let access;
  try { access = await resolveLicense(env, user.email); }
  catch (error) { return json(503, { error: error?.message || 'licensing_unavailable' }); }
  if (access.commercial && !access.mediaUpload) return json(403, { error: 'SAAS_MEDIA_UPLOAD_NOT_ALLOWED' });

  const url = new URL(request.url);
  const storagePath = String(url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!storagePath || !storagePath.startsWith(`${user.id}/`) || storagePath.includes('..')) return json(400, { error: 'invalid_storage_path' });
  const contentType = String(request.headers.get('content-type') || 'application/octet-stream').toLowerCase();
  const allowed = contentType.startsWith('image/') || contentType.startsWith('video/') || contentType === 'application/pdf';
  if (!allowed) return json(415, { error: 'unsupported_media_type' });

  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/clinical-media/${storagePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': contentType,
      'x-upsert': 'false',
    },
    body: request.body,
  });
  const body = await response.arrayBuffer();
  return new Response(body, { status: response.status, headers: { 'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
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

async function callPendingCheckoutRegistry(body) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/saas-checkout`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
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
    secret: env.ASAAS_SECRET,
    apiUrl: ASAAS_API_URL,
    checkoutFallback: ASAAS_CHECKOUT_URL,
    provider: 'asaas',
    billingSource: 'cloudflare-asaas',
  };
}

function credentialEnvironment(secret) {
  const value = String(secret || '').trim();
  if (!value) return 'missing';
  if (value.startsWith('$aact_hmlg_')) return 'sandbox';
  if (value.startsWith('$aact_prod_')) return 'production';
  return 'unknown';
}

function tomorrowAsaasDateTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)} 12:00:00`;
}

function checkoutPayload(planCode, requestId, origin, environment = 'production', flow = 'authenticated', plan = null) {
  const suffix = environment === 'sandbox' ? '&environment=sandbox' : '';
  const isPreconfirm = flow === 'pre_email_confirmation' && environment === 'production';
  const callback = isPreconfirm
    ? {
        successUrl: `${origin}/comercial/compra-concluida.html?status=success&plan=${encodeURIComponent(planCode)}`,
        cancelUrl: `${origin}/comercial/index.html?checkout=cancel&plan=${encodeURIComponent(planCode)}`,
        expiredUrl: `${origin}/comercial/index.html?checkout=expired&plan=${encodeURIComponent(planCode)}`,
      }
    : {
        successUrl: `${origin}/comercial/plano.html?asaas=success${suffix}`,
        cancelUrl: `${origin}/comercial/plano.html?asaas=cancel${suffix}`,
        expiredUrl: `${origin}/comercial/plano.html?asaas=expired${suffix}`,
      };

  const defaultPriceCents = planCode === 'pro_monthly' ? 4990 : 49900;
  const effectivePriceCents = Math.max(1, Number(plan?.effective_price_cents ?? plan?.price_cents ?? defaultPriceCents));
  const itemValue = effectivePriceCents / 100;
  const discountCents = Math.max(0, Number(plan?.discount_cents || 0));
  const partnerCode = String(plan?.partner_code || '');
  const descriptionSuffix = partnerCode
    ? ` · código ${partnerCode}${discountCents ? ` · desconto R$ ${(discountCents / 100).toFixed(2)}` : ''}`
    : '';

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
        description: `Uso ilimitado e upload de fotos e vídeos${descriptionSuffix}`,
        quantity: 1,
        value: itemValue,
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
      description: `Plano anual com uso ilimitado e upload de fotos e vídeos${descriptionSuffix}`,
      quantity: 1,
      value: itemValue,
    }],
    installment: { maxInstallmentCount: Math.max(1, Number(plan?.installment_max || 12)) },
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
  if (user.email) {
    try { await registerCommercial(env, user.email, environment === 'sandbox' ? 'asaas_sandbox_checkout' : 'asaas_checkout'); }
    catch (error) { return json(503, { error: error?.message || 'licensing_registration_failed' }); }
  }

  const input = await request.json().catch(() => null);
  const planCode = String(input?.planCode || '');
  const partnerCode = String(input?.partnerCode || '').trim().toUpperCase().slice(0, 64);
  const attributionSource = input?.attributionSource === 'ref_link' ? 'ref_link' : 'manual_code';
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) {
    return json(400, { error: 'invalid_plan' });
  }

  const registered = await callCheckoutRegistry(request, {
    action: 'create_request',
    planCode,
    partnerCode,
    attributionSource,
    environment,
  });
  if (!registered.response?.ok || !registered.payload?.requestId) {
    return json(registered.response?.status || 502, {
      error: registered.payload?.error || 'checkout_registry_failed',
    });
  }
  const requestId = String(registered.payload.requestId);

  const url = new URL(request.url);
  const providerPayload = checkoutPayload(planCode, requestId, url.origin, environment, 'authenticated', registered.payload?.plan || null);
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
    partnerCode: registered.payload?.plan?.partner_code || '',
    discountCents: Number(registered.payload?.plan?.discount_cents || 0),
    effectivePriceCents: Number(registered.payload?.plan?.effective_price_cents || registered.payload?.plan?.price_cents || 0),
    environment,
  });
}

async function pendingSignupAction(request, action) {
  const input = await request.json().catch(() => ({}));
  const { response, payload } = await callPendingCheckoutRegistry({ ...input, action });
  return json(response?.status || 502, payload || { error: 'signup_unavailable' });
}

async function createPreconfirmCheckout(request, env) {
  const config = asaasConfig(env, 'production');
  if (!config.secret) return json(503, { error: 'asaas_not_configured' });

  const input = await request.json().catch(() => null);
  const userId = String(input?.userId || '');
  const signupNonce = String(input?.signupNonce || '');
  const planCode = String(input?.planCode || '');
  const partnerCode = String(input?.partnerCode || '').trim().toUpperCase().slice(0, 64);
  const attributionSource = input?.attributionSource === 'ref_link' ? 'ref_link' : 'manual_code';
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) return json(400, { error: 'invalid_plan' });

  const registered = await callPendingCheckoutRegistry({
    action: 'create_pending_request',
    userId,
    signupNonce,
    planCode,
    partnerCode,
    attributionSource,
    environment: 'production',
  });
  if (registered.response?.ok && registered.payload?.status === 'paid') return json(200, { status: 'paid' });
  if (registered.response?.ok && registered.payload?.checkoutUrl) return json(200, registered.payload);
  if (!registered.response?.ok || !registered.payload?.requestId || !registered.payload?.requestSecret) {
    return json(registered.response?.status || 502, {
      error: registered.payload?.error || 'pending_checkout_registry_failed',
    });
  }

  const requestId = String(registered.payload.requestId);
  const requestSecret = String(registered.payload.requestSecret);
  const url = new URL(request.url);
  const providerPayload = checkoutPayload(
    planCode,
    requestId,
    url.origin,
    'production',
    'pre_email_confirmation',
    registered.payload?.plan || null,
  );
  const { response, payload: result } = await asaasFetch(env, '/checkouts', {
    method: 'POST',
    body: JSON.stringify(providerPayload),
  }, 'production');

  if (!response) return json(503, { error: 'asaas_not_configured' });
  if (!response.ok || !result?.id) {
    if (response.status >= 500 || response.ok) return json(503, { error: 'checkout_in_progress' });
    await callPendingCheckoutRegistry({
      action: 'mark_pending_failed',
      requestId,
      requestSecret,
      environment: 'production',
    });
    return json(response.status || 502, {
      error: 'asaas_checkout_failed',
      details: Array.isArray(result?.errors)
        ? result.errors.map((item) => ({ code: item.code, description: item.description }))
        : undefined,
    });
  }

  const checkoutUrl = checkoutUrlFromResult(result, 'production');
  const attached = await callPendingCheckoutRegistry({
    action: 'attach_pending_provider_checkout',
    requestId,
    requestSecret,
    externalCheckoutId: result.id,
    checkoutUrl,
    environment: 'production',
  });

  if (!attached.response?.ok) {
    await asaasFetch(env, `/checkouts/${encodeURIComponent(result.id)}/cancel`, { method: 'POST' }, 'production');
    return json(502, { error: 'pending_checkout_registry_attach_failed' });
  }

  return json(200, {
    checkoutId: result.id,
    checkoutUrl,
    planCode,
    partnerCode: registered.payload?.plan?.partner_code || '',
    discountCents: Number(registered.payload?.plan?.discount_cents || 0),
    effectivePriceCents: Number(registered.payload?.plan?.effective_price_cents || registered.payload?.plan?.price_cents || 0),
    environment: 'production',
    emailConfirmationRequiredForAccess: true,
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

  const bridgeResponse = await callBillingBridge(env, paymentId, environment);
  const bridgePayload = await bridgeResponse.json().catch(() => null);
  if (!bridgeResponse.ok) {
    return json(bridgeResponse.status || 502, {
      error: 'billing_bridge_failed',
      details: bridgePayload?.error || undefined,
    });
  }

  if (bridgePayload?.ownerId && bridgePayload?.planCode && bridgePayload?.billingStatus) {
    const billingUser = await authUserById(env, bridgePayload.ownerId);
    if (!billingUser?.email) return json(503, { error: 'billing_user_lookup_failed' });
    try {
      await syncCommercialLicense(env, {
        email: billingUser.email,
        planCode: bridgePayload.planCode,
        status: bridgePayload.billingStatus,
        expiresAt: bridgePayload.currentPeriodEnd || null,
        source: environment === 'sandbox' ? 'asaas_sandbox' : 'asaas',
        externalRef: String(verifiedPayment?.subscription || paymentId),
        actor: 'asaas_webhook',
      });
    } catch (error) { return json(503, { error: error?.message || 'licensing_sync_failed' }); }
  }

  return json(200, bridgePayload || { status: 'processed', paymentId, environment });
}

async function health(env, environment = 'production') {
  const config = asaasConfig(env, environment);
  const credentialEnvironmentValue = credentialEnvironment(config.secret);
  let asaasAuthStatus = null;
  let asaasApiValid = false;

  if (config.secret) {
    const { response } = await asaasFetch(env, '/wallets/', { method: 'GET' }, environment);
    asaasAuthStatus = response?.status ?? null;
    asaasApiValid = Boolean(response?.ok);
  }

  return json(200, {
    ok: true,
    service: 'commercial-asaas-api',
    environment,
    asaasApiConfigured: Boolean(config.secret),
    asaasApiValid,
    asaasAuthStatus,
    credentialEnvironment: credentialEnvironmentValue,
    credentialMatchesEnvironment: credentialEnvironmentValue === environment,
    webhookVerification: 'asaas_api_lookup_and_checkout_reconciliation',
    billingBridge: 'supabase_records_cloudflare_d1_access',
    partnerAdminConfig: PARTNER_ADMIN_EMAILS_CONFIG,
    cloudflareSecretsRequired: [environment === 'sandbox' ? 'ASSAS_SANDBOX_SECRET' : 'ASAAS_SECRET', 'LICENSE_SERVICE_SECRET', 'SUPABASE_SERVICE_ROLE_KEY'],
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === '/api/admin/partners'
      || url.pathname === '/api/admin/partner-sales'
      || url.pathname === '/api/admin/partner-commission'
    ) {
      return handlePartnerAdminRequest(request, env, url, { authenticateUser, serviceFetch, json });
    }

    if (url.pathname === '/api/license/me' && request.method === 'GET') return handleLicenseMe(request, env);
    if (url.pathname === '/api/license/register-commercial' && request.method === 'POST') return handleCommercialRegistration(request, env);
    if (url.pathname === '/api/clinical/mothers' && request.method === 'POST') return handleMotherCreate(request, env);
    if (url.pathname === '/api/clinical/media/upload' && request.method === 'POST') return handleClinicalMediaUpload(request, env);

    if (url.pathname === '/api/asaas/signup' && request.method === 'POST') return pendingSignupAction(request, 'prepare_signup');
    if (url.pathname === '/api/asaas/pending-status' && request.method === 'POST') return pendingSignupAction(request, 'pending_status');
    if (url.pathname === '/api/asaas/health' && request.method === 'GET') return health(env, 'production');
    if (url.pathname === '/api/asaas/preauth-checkout' && request.method === 'POST') return createPreconfirmCheckout(request, env);
    if (url.pathname === '/api/asaas/checkout' && request.method === 'POST') return createCheckout(request, env, 'production');
    if (url.pathname === '/api/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'production');

    if (url.pathname === '/api/sandbox/asaas/health' && request.method === 'GET') return health(env, 'sandbox');
    if (url.pathname === '/api/sandbox/asaas/checkout' && request.method === 'POST') return createCheckout(request, env, 'sandbox');
    if (url.pathname === '/api/sandbox/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'sandbox');

    if (url.pathname.startsWith('/api/')) return json(404, { error: 'not_found' });
    return env.ASSETS.fetch(request);
  },
};
