import { authenticateClinicalRequest, runtimeUserById } from './cloudflare-auth-runtime.js';
import { CLOUDFLARE_PBKDF2_ITERATIONS, cloudflarePasswordHash } from './cloudflare-auth-compat.js';

const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_SANDBOX_API_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_CHECKOUT_URL = 'https://asaas.com/checkoutSession/show?id=';
const ASAAS_SANDBOX_CHECKOUT_URL = 'https://sandbox.asaas.com/checkoutSession/show/';
const CHECKOUT_TTL_MS = 2 * 60 * 60 * 1000;
const enc = new TextEncoder();

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

function db(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function b64urlBytes(bytes) {
  let binary = '';
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return b64urlBytes(data);
}

async function sha256(value) {
  return b64urlBytes(await crypto.subtle.digest('SHA-256', enc.encode(String(value || ''))));
}

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function normalizePartnerCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '').slice(0, 64);
}

function normalizeAttributionSource(value) {
  return value === 'ref_link' ? 'ref_link' : 'manual_code';
}

function asaasConfig(env, environment = 'production') {
  if (environment === 'sandbox') {
    return {
      environment,
      secret: env.ASSAS_SANDBOX_SECRET,
      apiUrl: ASAAS_SANDBOX_API_URL,
      checkoutFallback: ASAAS_SANDBOX_CHECKOUT_URL,
      provider: 'asaas_sandbox',
    };
  }
  return {
    environment: 'production',
    secret: env.ASAAS_SECRET,
    apiUrl: ASAAS_API_URL,
    checkoutFallback: ASAAS_CHECKOUT_URL,
    provider: 'asaas',
  };
}

function credentialEnvironment(secret) {
  const value = String(secret || '').trim();
  if (!value) return 'missing';
  if (value.startsWith('$aact_hmlg_')) return 'sandbox';
  if (value.startsWith('$aact_prod_')) return 'production';
  return 'unknown';
}

async function asaasFetch(env, path, options = {}, environment = 'production') {
  const config = asaasConfig(env, environment);
  if (!config.secret) return { response: null, payload: null };
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      access_token: config.secret,
      accept: 'application/json',
      'user-agent': `ConsultoriaAmamentacao/2.0 (${environment}; cloudflare-d1)`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function licensingRequest(env, body) {
  if (!env.ARTISYS_LICENSING || !env.LICENSE_SERVICE_SECRET) throw new Error('licensing_not_configured');
  const response = await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-artisys-license-secret': env.LICENSE_SERVICE_SECRET,
    },
    body: JSON.stringify(body),
  }));
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || 'licensing_sync_failed');
  return payload;
}

async function syncCommercialLicense(env, { email, planCode, status, expiresAt, externalRef, environment }) {
  if (environment !== 'production' || !email) return;
  await licensingRequest(env, {
    action: 'sync',
    productCode: 'debora-lactacao',
    email,
    planCode,
    status,
    expiresAt: expiresAt || null,
    source: 'asaas',
    externalRef: externalRef || null,
    actor: 'asaas_webhook_d1',
  });
}

async function planByCode(env, planCode) {
  return db(env).prepare(`SELECT plan_code,display_name,billing_interval,price_cents,currency,installment_max,active
    FROM billing_plan_catalog WHERE plan_code=? AND active=1 LIMIT 1`).bind(planCode).first();
}

async function resolvePartnerOffer(env, code, plan) {
  const partnerCode = normalizePartnerCode(code);
  const subtotalCents = Number(plan.price_cents || 0);
  if (!partnerCode) {
    return { partner: null, partnerCode: '', subtotalCents, discountCents: 0, totalCents: subtotalCents, commissionCents: 0 };
  }

  const partner = await db(env).prepare(`SELECT * FROM partners
    WHERE active=1 AND upper(trim(code))=upper(trim(?)) LIMIT 1`).bind(partnerCode).first();
  if (!partner) throw Object.assign(new Error('invalid_partner_code'), { status: 400 });

  let discountCents = 0;
  if (partner.discount_type === 'percent') discountCents = Math.round(subtotalCents * Number(partner.discount_value || 0) / 100);
  if (partner.discount_type === 'fixed') discountCents = Math.round(Number(partner.discount_value || 0) * 100);
  discountCents = Math.max(0, Math.min(subtotalCents - 1, discountCents));
  const totalCents = subtotalCents - discountCents;

  let commissionCents = 0;
  if (partner.commission_type === 'percent') commissionCents = Math.round(totalCents * Number(partner.commission_value || 0) / 100);
  if (partner.commission_type === 'fixed') commissionCents = Math.round(Number(partner.commission_value || 0) * 100);
  commissionCents = Math.max(0, Math.min(totalCents, commissionCents));

  return {
    partner,
    partnerCode: String(partner.code || '').trim().toUpperCase(),
    subtotalCents,
    discountCents,
    totalCents,
    commissionCents,
  };
}

function tomorrowAsaasDateTime() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${date.toISOString().slice(0, 10)} 12:00:00`;
}

function checkoutPayload(planCode, requestId, origin, environment, flow, priced) {
  const suffix = environment === 'sandbox' ? '&environment=sandbox' : '';
  const preconfirm = flow === 'pre_email_confirmation' && environment === 'production';
  const callback = preconfirm
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

  const partnerSuffix = priced.partnerCode
    ? ` · código ${priced.partnerCode}${priced.discountCents ? ` · desconto R$ ${(priced.discountCents / 100).toFixed(2)}` : ''}`
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
        description: `Uso ilimitado e upload de fotos e vídeos${partnerSuffix}`,
        quantity: 1,
        value: priced.totalCents / 100,
      }],
      subscription: { cycle: 'MONTHLY', nextDueDate: tomorrowAsaasDateTime() },
    };
  }

  return {
    ...common,
    chargeTypes: ['DETACHED', 'INSTALLMENT'],
    items: [{
      name: 'Plano Pro anual',
      description: `Plano anual com uso ilimitado e upload de fotos e vídeos${partnerSuffix}`,
      quantity: 1,
      value: priced.totalCents / 100,
    }],
    installment: { maxInstallmentCount: Math.max(1, Number(priced.plan.installment_max || 12)) },
  };
}

function checkoutUrl(result, environment) {
  if (result?.link) return result.link;
  const prefix = environment === 'sandbox' ? ASAAS_SANDBOX_CHECKOUT_URL : ASAAS_CHECKOUT_URL;
  return `${prefix}${encodeURIComponent(result.id)}`;
}

async function preparePendingSignup(request, env) {
  const input = await request.json().catch(() => null);
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  const planCode = String(input?.planCode || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 256) {
    return json(400, { error: 'invalid_signup_fields' });
  }
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) return json(400, { error: 'invalid_plan' });

  const existingUser = await db(env).prepare('SELECT user_id FROM auth_users WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
  if (existingUser?.user_id) return json(409, { error: 'existing_account_login_required' });

  const nonce = randomToken(32);
  const nonceHash = await sha256(nonce);
  let pending = await db(env).prepare('SELECT * FROM billing_pending_signups WHERE lower(email)=lower(?) LIMIT 1').bind(email).first();
  if (pending) {
    const actual = await cloudflarePasswordHash(password, pending.password_salt, Number(pending.password_iterations || CLOUDFLARE_PBKDF2_ITERATIONS));
    if (!safeEqual(actual, pending.password_hash)) return json(400, { error: 'signup_credentials_invalid' });
    if (pending.status === 'activated') return json(409, { error: 'existing_account_login_required' });
    await db(env).prepare(`UPDATE billing_pending_signups
      SET plan_code=?,signup_nonce_hash=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?`)
      .bind(planCode, nonceHash, pending.user_id).run();
    return json(200, { userId: pending.user_id, signupNonce: nonce, status: pending.status });
  }

  const userId = crypto.randomUUID();
  const salt = randomToken(18);
  const hash = await cloudflarePasswordHash(password, salt, CLOUDFLARE_PBKDF2_ITERATIONS);
  await db(env).prepare(`INSERT INTO billing_pending_signups(
      user_id,email,password_salt,password_hash,password_iterations,plan_code,signup_nonce_hash,status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,'pending',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(userId, email, salt, hash, CLOUDFLARE_PBKDF2_ITERATIONS, planCode, nonceHash).run();
  return json(200, { userId, signupNonce: nonce, status: 'pending' });
}

async function pendingSignupByProof(env, userId, nonce) {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !nonce) return null;
  const row = await db(env).prepare('SELECT * FROM billing_pending_signups WHERE user_id=? LIMIT 1').bind(userId).first();
  if (!row) return null;
  return safeEqual(await sha256(nonce), row.signup_nonce_hash) ? row : null;
}

async function activatePendingSignup(env, userId) {
  const pending = await db(env).prepare('SELECT * FROM billing_pending_signups WHERE user_id=? LIMIT 1').bind(userId).first();
  if (!pending) return runtimeUserById(env, userId);
  if (!['paid', 'activated'].includes(pending.status)) throw new Error('payment_not_confirmed');
  const existing = await db(env).prepare('SELECT user_id FROM auth_users WHERE lower(email)=lower(?) LIMIT 1').bind(pending.email).first();
  if (existing && existing.user_id !== userId) throw new Error('email_already_registered');
  if (pending.status === 'activated') return runtimeUserById(env, userId);

  const now = new Date().toISOString();
  const userMetadata = JSON.stringify({ signup_source: 'commercial_saas', plan_intent: pending.plan_code });
  const appMetadata = JSON.stringify({ payment_activated: true, activation_source: 'asaas_verified_payment' });
  await db(env).batch([
    db(env).prepare(`INSERT INTO auth_users(
      user_id,email,phone,email_confirmed_at,phone_confirmed_at,created_at,updated_at,last_sign_in_at,
      user_metadata_json,app_metadata_json,password_reset_required,migrated_at
    ) VALUES(?,?,NULL,?,NULL,?,?,NULL,?,?,0,?)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,email_confirmed_at=excluded.email_confirmed_at,
      updated_at=excluded.updated_at,user_metadata_json=excluded.user_metadata_json,app_metadata_json=excluded.app_metadata_json,
      password_reset_required=0`).bind(userId, pending.email, now, pending.created_at || now, now, userMetadata, appMetadata, now),
    db(env).prepare(`INSERT INTO auth_credentials(
      user_id,password_salt,password_hash,password_iterations,password_algorithm,created_at,updated_at
    ) VALUES(?,?,?,?, 'PBKDF2-SHA256',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,
      password_iterations=excluded.password_iterations,password_algorithm=excluded.password_algorithm,updated_at=CURRENT_TIMESTAMP`)
      .bind(userId, pending.password_salt, pending.password_hash, Number(pending.password_iterations || CLOUDFLARE_PBKDF2_ITERATIONS)),
    db(env).prepare(`UPDATE billing_pending_signups SET status='activated',activated_at=?,updated_at=? WHERE user_id=?`).bind(now, now, userId),
  ]);
  return runtimeUserById(env, userId);
}

async function pendingStatus(request, env) {
  const input = await request.json().catch(() => ({}));
  const pending = await pendingSignupByProof(env, String(input.userId || ''), String(input.signupNonce || ''));
  if (!pending) return json(401, { error: 'invalid_signup_proof' });
  if (pending.status === 'activated') return json(200, { ok: true, status: 'account_activated' });

  const checkout = await db(env).prepare(`SELECT status FROM billing_checkout_requests
    WHERE owner_id=? AND provider='asaas' ORDER BY created_at DESC LIMIT 1`).bind(pending.user_id).first();
  if (checkout?.status !== 'paid') return json(200, { ok: true, status: 'awaiting_payment' });

  if (pending.status === 'pending') {
    const now = new Date().toISOString();
    await db(env).prepare(`UPDATE billing_pending_signups SET status='paid',payment_confirmed_at=COALESCE(payment_confirmed_at,?),
      updated_at=? WHERE user_id=?`).bind(now, now, pending.user_id).run();
  }
  await activatePendingSignup(env, pending.user_id);
  return json(200, { ok: true, status: 'account_activated' });
}

async function expireStaleCheckout(env, prior) {
  if (!prior?.id || !['pending_provider', 'checkout_created'].includes(prior.status)) return false;
  const createdAt = Date.parse(String(prior.created_at || ''));
  if (!Number.isFinite(createdAt) || Date.now() - createdAt <= CHECKOUT_TTL_MS) return false;
  await db(env).batch([
    db(env).prepare(`UPDATE billing_checkout_requests SET status='expired',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(prior.id),
    db(env).prepare(`UPDATE partner_attributions SET status='cancelled',commission_status=CASE WHEN commission_status='approved' THEN commission_status ELSE 'cancelled' END,
      updated_at=CURRENT_TIMESTAMP WHERE checkout_request_id=?`).bind(prior.id),
  ]);
  return true;
}

async function createCheckoutRequest(env, { ownerId, planCode, provider, partnerCode, attributionSource }) {
  const plan = await planByCode(env, planCode);
  if (!plan) throw Object.assign(new Error('plan_not_available'), { status: 404 });
  const priced = await resolvePartnerOffer(env, partnerCode, plan);
  priced.plan = plan;

  let prior = await db(env).prepare(`SELECT * FROM billing_checkout_requests
    WHERE owner_id=? AND provider=? AND status IN ('pending_provider','checkout_created')
    ORDER BY created_at DESC LIMIT 1`).bind(ownerId, provider).first();
  if (prior && await expireStaleCheckout(env, prior)) prior = null;
  if (prior) {
    if (prior.plan_code !== planCode) throw Object.assign(new Error('pending_checkout_other_plan'), { status: 409 });
    if (normalizePartnerCode(partnerCode) && normalizePartnerCode(prior.partner_code_snapshot) !== normalizePartnerCode(partnerCode)) {
      throw Object.assign(new Error('pending_checkout_partner_mismatch'), { status: 409 });
    }
    if (prior.status === 'checkout_created' && prior.checkout_url) return { reused: true, request: prior, priced };
    throw Object.assign(new Error('checkout_in_progress'), { status: 409 });
  }

  const id = crypto.randomUUID();
  await db(env).prepare(`INSERT INTO billing_checkout_requests(
    id,owner_id,plan_code,provider,status,partner_id,partner_code_snapshot,attribution_source,
    subtotal_cents,discount_cents,total_cents,commission_cents,metadata_json,created_at,updated_at
  ) VALUES(?,?,?,?, 'pending_provider',?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
    .bind(
      id, ownerId, planCode, provider,
      priced.partner?.id || null, priced.partnerCode || null, priced.partner ? normalizeAttributionSource(attributionSource) : null,
      priced.subtotalCents, priced.discountCents, priced.totalCents, priced.commissionCents,
      JSON.stringify({ backend: 'cloudflare-d1' }),
    ).run();

  if (priced.partner) {
    await db(env).prepare(`INSERT INTO partner_attributions(
      id,partner_id,checkout_request_id,owner_id,plan_code,partner_code_snapshot,attribution_source,
      commission_type_snapshot,commission_value_snapshot,discount_type_snapshot,discount_value_snapshot,
      subtotal_cents,discount_cents,total_cents,commission_cents,status,commission_status,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'captured','none',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
      .bind(
        crypto.randomUUID(), priced.partner.id, id, ownerId, planCode, priced.partnerCode,
        normalizeAttributionSource(attributionSource), priced.partner.commission_type, Number(priced.partner.commission_value || 0),
        priced.partner.discount_type, Number(priced.partner.discount_value || 0), priced.subtotalCents, priced.discountCents,
        priced.totalCents, priced.commissionCents,
      ).run();
  }
  return { reused: false, request: { id, owner_id: ownerId, plan_code: planCode, provider }, priced };
}

async function attachCheckout(env, requestId, externalCheckoutId, url) {
  await db(env).batch([
    db(env).prepare(`UPDATE billing_checkout_requests SET status='checkout_created',external_checkout_id=?,checkout_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(externalCheckoutId, url, requestId),
    db(env).prepare(`UPDATE partner_attributions SET status='checkout_created',updated_at=CURRENT_TIMESTAMP WHERE checkout_request_id=?`)
      .bind(requestId),
  ]);
}

async function failCheckout(env, requestId) {
  await db(env).batch([
    db(env).prepare(`UPDATE billing_checkout_requests SET status='failed',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(requestId),
    db(env).prepare(`UPDATE partner_attributions SET status='cancelled',commission_status=CASE WHEN commission_status='approved' THEN commission_status ELSE 'cancelled' END,
      updated_at=CURRENT_TIMESTAMP WHERE checkout_request_id=?`).bind(requestId),
  ]);
}

async function createProviderCheckout(request, env, environment, flow, ownerId, planCode, partnerCode, attributionSource) {
  const config = asaasConfig(env, environment);
  if (!config.secret) return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });

  if (flow === 'pre_email_confirmation') {
    const paid = await db(env).prepare(`SELECT id,status FROM billing_checkout_requests WHERE owner_id=? AND provider='asaas'
      AND plan_code=? AND status='paid' ORDER BY created_at DESC LIMIT 1`).bind(ownerId, planCode).first();
    if (paid) return json(200, { status: 'paid', planCode, environment: 'production' });
  }

  let registered;
  try {
    registered = await createCheckoutRequest(env, { ownerId, planCode, provider: config.provider, partnerCode, attributionSource });
  } catch (error) {
    return json(error.status || 500, { error: error.message || 'checkout_request_failed' });
  }

  if (registered.reused) {
    return json(200, {
      status: 'checkout_created', checkoutId: registered.request.external_checkout_id,
      checkoutUrl: registered.request.checkout_url, planCode,
      partnerCode: registered.request.partner_code_snapshot || '',
      discountCents: Number(registered.request.discount_cents || 0),
      effectivePriceCents: Number(registered.request.total_cents || registered.priced.totalCents), environment,
    });
  }

  const origin = new URL(request.url).origin;
  const payload = checkoutPayload(planCode, registered.request.id, origin, environment, flow, registered.priced);
  const { response, payload: result } = await asaasFetch(env, '/checkouts', { method: 'POST', body: JSON.stringify(payload) }, environment);
  if (!response || !response.ok || !result?.id) {
    if (response && response.status < 500) await failCheckout(env, registered.request.id);
    return json(response?.status || 503, {
      error: response ? 'asaas_checkout_failed' : (environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured'),
      details: Array.isArray(result?.errors) ? result.errors.map((item) => ({ code: item.code, description: item.description })) : undefined,
    });
  }

  const providerUrl = checkoutUrl(result, environment);
  await attachCheckout(env, registered.request.id, String(result.id), providerUrl);
  return json(200, {
    status: 'checkout_created', checkoutId: result.id, checkoutUrl: providerUrl, planCode,
    partnerCode: registered.priced.partnerCode, discountCents: registered.priced.discountCents,
    effectivePriceCents: registered.priced.totalCents, environment,
    ...(flow === 'pre_email_confirmation' ? { activationAfterPayment: true } : {}),
  });
}

async function authenticatedCheckout(request, env, environment) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'unauthorized' });
  const input = await request.json().catch(() => ({}));
  const planCode = String(input.planCode || '');
  if (!['pro_monthly', 'pro_annual'].includes(planCode)) return json(400, { error: 'invalid_plan' });
  return createProviderCheckout(request, env, environment, 'authenticated', user.id, planCode,
    normalizePartnerCode(input.partnerCode), normalizeAttributionSource(input.attributionSource));
}

async function preauthCheckout(request, env) {
  const input = await request.json().catch(() => ({}));
  const userId = String(input.userId || '');
  const nonce = String(input.signupNonce || '');
  const planCode = String(input.planCode || '');
  const pending = await pendingSignupByProof(env, userId, nonce);
  if (!pending) return json(401, { error: 'invalid_signup_proof' });
  if (pending.plan_code !== planCode) return json(409, { error: 'pending_checkout_other_plan' });
  return createProviderCheckout(request, env, 'production', 'pre_email_confirmation', userId, planCode,
    normalizePartnerCode(input.partnerCode), normalizeAttributionSource(input.attributionSource));
}

function parseCheckoutReference(value) {
  const match = String(value || '').match(/^saas_checkout:([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

function billingTransition(status) {
  const normalized = String(status || '').toUpperCase();
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(normalized)) return 'active';
  if (normalized === 'OVERDUE') return 'past_due';
  if (['REFUNDED', 'REFUND_REQUESTED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL', 'DELETED'].includes(normalized)) return 'cancelled';
  return null;
}

function attributionStatus(providerStatus) {
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(providerStatus)) return 'paid';
  if (['REFUNDED', 'REFUND_REQUESTED'].includes(providerStatus)) return 'refunded';
  if (['CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE', 'AWAITING_CHARGEBACK_REVERSAL'].includes(providerStatus)) return 'chargeback';
  if (providerStatus === 'DELETED') return 'cancelled';
  return null;
}

function currentPeriodEnd(payment, planCode) {
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(payment?.dueDate || ''))
    ? new Date(`${payment.dueDate}T12:00:00Z`)
    : new Date();
  if (planCode === 'pro_annual') due.setUTCFullYear(due.getUTCFullYear() + 1);
  else due.setUTCMonth(due.getUTCMonth() + 1);
  return due.toISOString();
}

async function mapPayment(env, payment, provider, environment) {
  const requestId = parseCheckoutReference(payment?.externalReference);
  if (requestId) {
    const checkout = await db(env).prepare('SELECT * FROM billing_checkout_requests WHERE id=? AND provider=? LIMIT 1').bind(requestId, provider).first();
    if (!checkout?.external_checkout_id) return null;
    const { response, payload } = await asaasFetch(env, `/payments?checkoutSession=${encodeURIComponent(checkout.external_checkout_id)}&limit=100`, { method: 'GET' }, environment);
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!response?.ok || !rows.some((item) => String(item?.id || '') === String(payment.id))) return null;
    return { checkout, renewal: false };
  }

  const subscriptionId = String(payment?.subscription || '');
  if (!subscriptionId) return null;
  const subscription = await db(env).prepare(`SELECT * FROM subscriptions
    WHERE provider=? AND external_subscription_id=? LIMIT 1`).bind(provider, subscriptionId).first();
  if (!subscription) return null;
  const checkout = subscription.origin_checkout_request_id
    ? await db(env).prepare('SELECT * FROM billing_checkout_requests WHERE id=? LIMIT 1').bind(subscription.origin_checkout_request_id).first()
    : await db(env).prepare(`SELECT * FROM billing_checkout_requests WHERE owner_id=? AND provider=? AND plan_code=? AND status='paid'
      ORDER BY created_at DESC LIMIT 1`).bind(subscription.owner_id, provider, subscription.plan_code).first();
  return checkout ? { checkout, renewal: true } : null;
}

async function updateAttribution(env, checkout, providerStatus, paymentId) {
  if (!checkout?.partner_id) return;
  const nextStatus = attributionStatus(providerStatus);
  if (!nextStatus) return;
  const now = new Date().toISOString();
  if (nextStatus === 'paid') {
    await db(env).prepare(`UPDATE partner_attributions SET status='paid',provider_status=?,paid_at=COALESCE(paid_at,?),
      commission_status=CASE WHEN commission_cents>0 AND commission_status='none' THEN 'pending' ELSE commission_status END,
      updated_at=? WHERE checkout_request_id=?`).bind(providerStatus, now, now, checkout.id).run();
  } else {
    await db(env).prepare(`UPDATE partner_attributions SET status=?,provider_status=?,commission_status=CASE WHEN commission_status='approved' THEN 'reversed' ELSE 'cancelled' END,
      updated_at=? WHERE checkout_request_id=?`).bind(nextStatus, providerStatus, now, checkout.id).run();
  }
  await db(env).prepare(`UPDATE billing_checkout_requests SET metadata_json=json_set(COALESCE(metadata_json,'{}'),'$.last_payment_id',?),updated_at=? WHERE id=?`)
    .bind(paymentId, now, checkout.id).run();
}

async function updateSubscription(env, checkout, payment, status, environment) {
  const provider = environment === 'sandbox' ? 'asaas_sandbox' : 'asaas';
  const externalSubscriptionId = payment?.subscription ? String(payment.subscription) : null;
  const externalCustomerId = payment?.customer ? String(payment.customer) : null;
  const periodEnd = currentPeriodEnd(payment, checkout.plan_code);
  const id = crypto.randomUUID();
  await db(env).prepare(`INSERT INTO subscriptions(
    id,owner_id,provider,external_customer_id,external_subscription_id,origin_checkout_request_id,plan_code,status,current_period_end,metadata_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,'{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  ON CONFLICT(owner_id,provider) DO UPDATE SET
    external_customer_id=excluded.external_customer_id,external_subscription_id=COALESCE(excluded.external_subscription_id,subscriptions.external_subscription_id),
    origin_checkout_request_id=COALESCE(subscriptions.origin_checkout_request_id,excluded.origin_checkout_request_id),plan_code=excluded.plan_code,
    status=excluded.status,current_period_end=excluded.current_period_end,updated_at=CURRENT_TIMESTAMP`)
    .bind(id, checkout.owner_id, provider, externalCustomerId, externalSubscriptionId, checkout.id, checkout.plan_code, status, periodEnd).run();
  return { subscriptionId: externalSubscriptionId, periodEnd };
}

async function eventForPayment(env, provider, eventId, paymentId, payload) {
  const existing = await db(env).prepare('SELECT * FROM billing_webhook_events WHERE provider=? AND external_event_id=? LIMIT 1').bind(provider, eventId).first();
  if (existing) return { existing, inserted: false };
  await db(env).prepare(`INSERT INTO billing_webhook_events(
    id,provider,external_event_id,event_type,status,payment_id,payload_json,received_at
  ) VALUES(?,?,?,?, 'received',?,?,CURRENT_TIMESTAMP)`)
    .bind(crypto.randomUUID(), provider, eventId, String(payload?.event || ''), paymentId || null, JSON.stringify(payload || {})).run();
  return { existing: null, inserted: true };
}

async function finishEvent(env, provider, eventId, ok, error = null) {
  await db(env).prepare(`UPDATE billing_webhook_events SET status=?,error_message=?,processed_at=CURRENT_TIMESTAMP
    WHERE provider=? AND external_event_id=?`).bind(ok ? 'processed' : 'failed', error, provider, eventId).run();
}

async function handleWebhook(request, env, environment) {
  const config = asaasConfig(env, environment);
  if (!config.secret) return json(503, { error: environment === 'sandbox' ? 'asaas_sandbox_not_configured' : 'asaas_not_configured' });
  const payload = await request.json().catch(() => null);
  const payment = payload?.payment;
  const paymentId = String(payment?.id || '');
  const eventId = String(payload?.id || payload?.event || '') + ':' + paymentId;
  if (!paymentId || !eventId) return json(400, { error: 'invalid_webhook_payload' });

  const event = await eventForPayment(env, config.provider, eventId, paymentId, payload);
  if (event.existing?.status === 'processed') return json(200, { status: 'already_processed', eventId });

  const { response, payload: verified } = await asaasFetch(env, `/payments/${encodeURIComponent(paymentId)}`, { method: 'GET' }, environment);
  if (!response?.ok || !verified?.id || String(verified.id) !== paymentId) {
    await finishEvent(env, config.provider, eventId, false, 'payment_verification_failed');
    return json(401, { error: 'payment_verification_failed' });
  }

  const mapped = await mapPayment(env, verified, config.provider, environment);
  if (!mapped?.checkout) {
    await finishEvent(env, config.provider, eventId, false, 'payment_not_mapped');
    return json(202, { status: 'ignored_unmapped_payment', paymentId });
  }

  const transition = billingTransition(verified.status);
  if (!transition) {
    await finishEvent(env, config.provider, eventId, true);
    return json(200, { status: 'ignored_non_terminal_status', paymentId, providerStatus: verified.status });
  }

  try {
    await db(env).prepare(`UPDATE billing_checkout_requests SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(transition === 'active' ? 'paid' : transition, mapped.checkout.id).run();
    await updateAttribution(env, mapped.checkout, String(verified.status || '').toUpperCase(), paymentId);
    const subscription = await updateSubscription(env, mapped.checkout, verified, transition, environment);
    let activationStatus = null;
    if (transition === 'active' && environment === 'production') {
      const pending = await db(env).prepare('SELECT status FROM billing_pending_signups WHERE user_id=? LIMIT 1').bind(mapped.checkout.owner_id).first();
      if (pending && pending.status !== 'activated') {
        const now = new Date().toISOString();
        await db(env).prepare(`UPDATE billing_pending_signups SET status='paid',payment_confirmed_at=COALESCE(payment_confirmed_at,?),updated_at=? WHERE user_id=?`)
          .bind(now, now, mapped.checkout.owner_id).run();
        await activatePendingSignup(env, mapped.checkout.owner_id);
        activationStatus = 'account_activated';
      }
    }

    const user = await runtimeUserById(env, mapped.checkout.owner_id);
    await syncCommercialLicense(env, {
      email: user?.email,
      planCode: mapped.checkout.plan_code,
      status: transition,
      expiresAt: subscription.periodEnd,
      externalRef: subscription.subscriptionId || paymentId,
      environment,
    });

    await finishEvent(env, config.provider, eventId, true);
    return json(200, {
      status: 'processed', eventId: event.eventId, paymentId, ownerId: mapped.checkout.owner_id,
      planCode: mapped.checkout.plan_code, billingStatus: transition, currentPeriodEnd: subscription.periodEnd,
      renewal: mapped.renewal, activationStatus, environment,
    });
  } catch (error) {
    await finishEvent(env, config.provider, eventId, false, String(error?.message || error).slice(0, 1000));
    return json(500, { error: 'billing_state_apply_failed', eventId: event.eventId, details: error?.message || undefined });
  }
}

function adminEmails(env) {
  return new Set(String(env.PARTNER_ADMIN_EMAILS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));
}

async function requireAdmin(request, env) {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.email) return null;
  if (user?.app_metadata?.partner_admin === true) return user;
  return adminEmails(env).has(String(user.email).trim().toLowerCase()) ? user : null;
}

function validPartnerInput(input) {
  const value = {
    id: String(input?.id || ''),
    name: String(input?.name || '').trim(),
    code: normalizePartnerCode(input?.code),
    partnerType: String(input?.partnerType || 'partner'),
    commissionType: String(input?.commissionType || 'none'),
    commissionValue: Number(input?.commissionValue || 0),
    discountType: String(input?.discountType || 'none'),
    discountValue: Number(input?.discountValue || 0),
    active: input?.active !== false ? 1 : 0,
  };
  if (value.name.length < 2 || value.name.length > 160) return { error: 'invalid_partner_name' };
  if (!/^[A-Z0-9_-]{2,64}$/.test(value.code)) return { error: 'invalid_partner_code' };
  if (!['partner', 'influencer', 'campaign'].includes(value.partnerType)) return { error: 'invalid_partner_type' };
  if (!['none', 'percent', 'fixed'].includes(value.commissionType)) return { error: 'invalid_commission_type' };
  if (!['none', 'percent', 'fixed'].includes(value.discountType)) return { error: 'invalid_discount_type' };
  if (!Number.isFinite(value.commissionValue) || value.commissionValue < 0 || (value.commissionType === 'percent' && value.commissionValue > 100)) return { error: 'invalid_commission_value' };
  if (!Number.isFinite(value.discountValue) || value.discountValue < 0 || (value.discountType === 'percent' && value.discountValue > 100)) return { error: 'invalid_discount_value' };
  return { value };
}

async function partnerAdmin(request, env, url) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json(403, { error: 'partner_admin_forbidden' });

  if (url.pathname === '/api/admin/partners' && request.method === 'GET') {
    const result = await db(env).prepare(`SELECT id,name,code,partner_type,active,commission_type,commission_value,
      discount_type,discount_value,created_at,updated_at FROM partners ORDER BY created_at DESC`).all();
    return json(200, { partners: result.results || [] });
  }

  if (url.pathname === '/api/admin/partners' && request.method === 'POST') {
    const parsed = validPartnerInput(await request.json().catch(() => null));
    if (parsed.error) return json(400, { error: parsed.error });
    const p = parsed.value;
    try {
      if (p.id) {
        if (!/^[0-9a-f-]{36}$/i.test(p.id)) return json(400, { error: 'invalid_partner_id' });
        await db(env).prepare(`UPDATE partners SET name=?,code=?,partner_type=?,active=?,commission_type=?,commission_value=?,
          discount_type=?,discount_value=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .bind(p.name, p.code, p.partnerType, p.active, p.commissionType, p.commissionValue, p.discountType, p.discountValue, p.id).run();
      } else {
        p.id = crypto.randomUUID();
        await db(env).prepare(`INSERT INTO partners(id,name,code,partner_type,active,commission_type,commission_value,discount_type,discount_value,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
          .bind(p.id, p.name, p.code, p.partnerType, p.active, p.commissionType, p.commissionValue, p.discountType, p.discountValue).run();
      }
    } catch (error) {
      const conflict = String(error?.message || '').includes('UNIQUE');
      return json(conflict ? 409 : 500, { error: conflict ? 'partner_code_conflict' : 'partner_save_failed' });
    }
    const partner = await db(env).prepare('SELECT * FROM partners WHERE id=?').bind(p.id).first();
    return json(200, { partner });
  }

  if (url.pathname === '/api/admin/partner-sales' && request.method === 'GET') {
    const conditions = [];
    const bindings = [];
    const add = (sql, value) => { if (value) { conditions.push(sql); bindings.push(value); } };
    add('a.partner_id=?', url.searchParams.get('partnerId'));
    add('a.plan_code=?', url.searchParams.get('plan'));
    add('a.status=?', url.searchParams.get('status'));
    add('a.commission_status=?', url.searchParams.get('commissionStatus'));
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from) { conditions.push('a.created_at>=?'); bindings.push(from); }
    if (to) { conditions.push('a.created_at<=?'); bindings.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await db(env).prepare(`SELECT a.*,p.name AS partner_name,p.code AS partner_code
      FROM partner_attributions a JOIN partners p ON p.id=a.partner_id ${where}
      ORDER BY a.created_at DESC LIMIT 500`).bind(...bindings).all();
    const sales = (result.results || []).map((row) => ({ ...row, partners: { name: row.partner_name, code: row.partner_code } }));
    const summary = sales.reduce((acc, sale) => {
      acc.attributions += 1;
      if (sale.status === 'paid') { acc.paidSales += 1; acc.revenueCents += Number(sale.total_cents || 0); }
      if (sale.commission_status === 'pending') acc.pendingCommissionCents += Number(sale.commission_cents || 0);
      if (sale.commission_status === 'approved') acc.approvedCommissionCents += Number(sale.commission_cents || 0);
      if (sale.commission_status === 'reversed') acc.reversedCommissionCents += Number(sale.commission_cents || 0);
      return acc;
    }, { attributions: 0, paidSales: 0, revenueCents: 0, pendingCommissionCents: 0, approvedCommissionCents: 0, reversedCommissionCents: 0 });
    return json(200, { summary, sales });
  }

  if (url.pathname === '/api/admin/partner-commission' && request.method === 'POST') {
    const input = await request.json().catch(() => ({}));
    const id = String(input.attributionId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'invalid_attribution_id' });
    const result = await db(env).prepare(`UPDATE partner_attributions SET commission_status='approved',commission_approved_at=?,
      commission_approved_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='paid' AND commission_status='pending'`)
      .bind(new Date().toISOString(), admin.email, id).run();
    if (Number(result?.meta?.changes || 0) !== 1) return json(409, { error: 'commission_approval_failed' });
    return json(200, { status: 'approved', attributionId: id });
  }
  return json(404, { error: 'not_found' });
}

async function health(env, environment) {
  const config = asaasConfig(env, environment);
  let asaasAuthStatus = null;
  let asaasApiValid = false;
  let d1BillingReady = false;
  try {
    const row = await db(env).prepare("SELECT state_value FROM runtime_state WHERE state_key='billing_backend' LIMIT 1").first();
    d1BillingReady = row?.state_value === 'cloudflare-d1';
  } catch {}
  if (config.secret) {
    const { response } = await asaasFetch(env, '/wallets/', { method: 'GET' }, environment);
    asaasAuthStatus = response?.status ?? null;
    asaasApiValid = Boolean(response?.ok);
  }
  return json(200, {
    ok: true,
    service: 'commercial-asaas-api',
    environment,
    billingBackend: 'cloudflare-d1',
    d1BillingReady,
    asaasApiConfigured: Boolean(config.secret),
    asaasApiValid,
    asaasAuthStatus,
    credentialEnvironment: credentialEnvironment(config.secret),
    credentialMatchesEnvironment: credentialEnvironment(config.secret) === environment,
    webhookVerification: 'asaas_api_lookup_and_cloudflare_d1_reconciliation',
    recurringReconciliation: 'subscription_id',
    cloudflareSecretsRequired: [environment === 'sandbox' ? 'ASSAS_SANDBOX_SECRET' : 'ASAAS_SECRET', 'LICENSE_SERVICE_SECRET', 'CLINICAL_AUTH_SECRET'],
  });
}

const ROUTES = new Set([
  '/api/asaas/signup', '/api/asaas/pending-status', '/api/asaas/health',
  '/api/asaas/preauth-checkout', '/api/asaas/checkout', '/api/webhooks/asaas',
  '/api/sandbox/asaas/health', '/api/sandbox/asaas/checkout', '/api/sandbox/webhooks/asaas',
  '/api/admin/partners', '/api/admin/partner-sales', '/api/admin/partner-commission',
]);

export async function handleCloudflareBillingRuntime(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB || !ROUTES.has(url.pathname)) return null;
  try {
    if (url.pathname.startsWith('/api/admin/')) return partnerAdmin(request, env, url);
    if (url.pathname === '/api/asaas/signup' && request.method === 'POST') return preparePendingSignup(request, env);
    if (url.pathname === '/api/asaas/pending-status' && request.method === 'POST') return pendingStatus(request, env);
    if (url.pathname === '/api/asaas/health' && request.method === 'GET') return health(env, 'production');
    if (url.pathname === '/api/asaas/preauth-checkout' && request.method === 'POST') return preauthCheckout(request, env);
    if (url.pathname === '/api/asaas/checkout' && request.method === 'POST') return authenticatedCheckout(request, env, 'production');
    if (url.pathname === '/api/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'production');
    if (url.pathname === '/api/sandbox/asaas/health' && request.method === 'GET') return health(env, 'sandbox');
    if (url.pathname === '/api/sandbox/asaas/checkout' && request.method === 'POST') return authenticatedCheckout(request, env, 'sandbox');
    if (url.pathname === '/api/sandbox/webhooks/asaas' && request.method === 'POST') return handleWebhook(request, env, 'sandbox');
    return json(405, { error: 'method_not_allowed' });
  } catch (error) {
    return json(500, { error: 'cloudflare_billing_runtime_failed', details: error?.message || String(error) });
  }
}

export {
  billingTransition,
  resolvePartnerOffer,
  currentPeriodEnd,
  normalizePartnerCode,
  checkoutPayload,
  CLOUDFLARE_PBKDF2_ITERATIONS,
};
