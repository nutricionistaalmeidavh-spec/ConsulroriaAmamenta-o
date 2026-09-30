import { authenticateClinicalRequest, runtimeUserById } from './cloudflare-clinical-runtime.js';

const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_SANDBOX_API_URL = 'https://api-sandbox.asaas.com/v3';
const ACTIVE_LIKE = new Set(['active', 'trialing', 'past_due']);

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function db(env) {
  if (!env.CLINICAL_DB) throw new Error('clinical_db_not_configured');
  return env.CLINICAL_DB;
}

function providerFor(environment = 'production') {
  return environment === 'sandbox' ? 'asaas_sandbox' : 'asaas';
}

function providerSecret(env, environment = 'production') {
  return environment === 'sandbox' ? env.ASSAS_SANDBOX_SECRET : env.ASAAS_SECRET;
}

function providerApiUrl(environment = 'production') {
  return environment === 'sandbox' ? ASAAS_SANDBOX_API_URL : ASAAS_API_URL;
}

function webhookToken(env, environment = 'production') {
  return environment === 'sandbox' ? env.ASAAS_SANDBOX_WEBHOOK_TOKEN : env.ASAAS_WEBHOOK_TOKEN;
}

function safeEqual(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function metadataFor(subscription) {
  try {
    const value = JSON.parse(subscription?.metadata_json || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function validProviderId(value) {
  return /^[A-Za-z0-9_.-]{3,160}$/.test(String(value || ''));
}

function isoOrNull(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function subscriptionCancellationState(subscription, nowMs = Date.now()) {
  if (!subscription) {
    return {
      status: 'none',
      planCode: null,
      currentPeriodEnd: null,
      recurring: false,
      autoRenew: false,
      cancelAtPeriodEnd: false,
      canCancel: false,
      accessUntil: null,
      expired: false,
      cancellationRequestedAt: null,
      providerDeletedAt: null,
    };
  }

  const metadata = metadataFor(subscription);
  const currentPeriodEnd = isoOrNull(subscription.current_period_end);
  const periodEndMs = currentPeriodEnd ? Date.parse(currentPeriodEnd) : NaN;
  const cancelAtPeriodEnd = metadata.cancel_at_period_end === true;
  const expired = cancelAtPeriodEnd && Number.isFinite(periodEndMs) && periodEndMs <= nowMs;
  const activeLike = ACTIVE_LIKE.has(String(subscription.status || ''));
  const recurring = subscription.plan_code === 'pro_monthly' && Boolean(subscription.external_subscription_id);

  return {
    status: expired ? 'expired' : String(subscription.status || 'none'),
    planCode: String(subscription.plan_code || ''),
    currentPeriodEnd,
    recurring,
    autoRenew: recurring && activeLike && !cancelAtPeriodEnd && !expired,
    cancelAtPeriodEnd,
    canCancel: recurring && activeLike && !cancelAtPeriodEnd && !expired && Boolean(currentPeriodEnd),
    accessUntil: cancelAtPeriodEnd ? currentPeriodEnd : null,
    expired,
    cancellationRequestedAt: isoOrNull(metadata.cancellation_requested_at),
    providerDeletedAt: isoOrNull(metadata.provider_deleted_at),
  };
}

export function shouldPreserveCancelledRecurringAccess(subscription, providerStatus, nowMs = Date.now()) {
  const state = subscriptionCancellationState(subscription, nowMs);
  return String(providerStatus || '').toUpperCase() === 'DELETED'
    && state.cancelAtPeriodEnd
    && Boolean(state.currentPeriodEnd)
    && !state.expired;
}

async function asaasFetch(env, path, options = {}, environment = 'production') {
  const secret = providerSecret(env, environment);
  if (!secret) return { response: null, payload: null };
  const response = await fetch(`${providerApiUrl(environment)}${path}`, {
    ...options,
    signal: AbortSignal.timeout(10000),
    headers: {
      access_token: secret,
      accept: 'application/json',
      'user-agent': `ConsultoriaAmamentacao/2.0 (${environment}; subscription-cancellation)`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

async function acquireClaim(env, key, ttlMs = 120000) {
  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  const result = await db(env).prepare(`INSERT INTO billing_processing_claims(claim_key,token,expires_at) VALUES(?,?,?)
    ON CONFLICT(claim_key) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at
    WHERE julianday(billing_processing_claims.expires_at)<=julianday(?)`)
    .bind(key, token, new Date(Date.now() + ttlMs).toISOString(), now).run();
  return Number(result?.meta?.changes || 0) > 0 ? token : null;
}

async function releaseClaim(env, key, token) {
  if (!token) return;
  await db(env).prepare('DELETE FROM billing_processing_claims WHERE claim_key=? AND token=?').bind(key, token).run();
}

async function localSubscription(env, ownerId, environment = 'production') {
  return db(env).prepare('SELECT * FROM subscriptions WHERE owner_id=? AND provider=? LIMIT 1')
    .bind(ownerId, providerFor(environment)).first();
}

async function subscriptionByExternalId(env, externalId, environment = 'production') {
  return db(env).prepare('SELECT * FROM subscriptions WHERE provider=? AND external_subscription_id=? LIMIT 1')
    .bind(providerFor(environment), externalId).first();
}

async function saveCancellationMetadata(env, subscription, patch) {
  const metadata = {
    ...metadataFor(subscription),
    ...patch,
    backend: 'cloudflare-d1',
  };
  await db(env).prepare('UPDATE subscriptions SET metadata_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
    .bind(JSON.stringify(metadata), subscription.id).run();
  return { ...subscription, metadata_json: JSON.stringify(metadata) };
}

async function licensingRequest(env, body) {
  if (!env.ARTISYS_LICENSING?.fetch || !env.LICENSE_SERVICE_SECRET) return null;
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

async function expireCancelledSubscription(env, subscription, environment = 'production') {
  const state = subscriptionCancellationState(subscription);
  if (!state.expired || !ACTIVE_LIKE.has(String(subscription.status || ''))) return false;

  const user = await runtimeUserById(env, subscription.owner_id).catch(() => null);
  if (user?.email) {
    await licensingRequest(env, {
      action: 'sync',
      productCode: 'debora-lactacao',
      email: user.email,
      planCode: subscription.plan_code,
      status: 'cancelled',
      expiresAt: subscription.current_period_end || null,
      source: environment === 'sandbox' ? 'asaas_sandbox' : 'asaas',
      externalRef: subscription.external_subscription_id || subscription.id,
      actor: 'asaas_subscription_expiry_d1',
    });
  }

  const metadata = {
    ...metadataFor(subscription),
    access_expired_at: new Date().toISOString(),
  };
  await db(env).prepare(`UPDATE subscriptions SET status='expired',metadata_json=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND status IN ('active','trialing','past_due')`)
    .bind(JSON.stringify(metadata), subscription.id).run();
  return true;
}

async function confirmedDeletedAtProvider(env, subscription, environment = 'production') {
  const subscriptionId = String(subscription?.external_subscription_id || '');
  const customerId = String(subscription?.external_customer_id || '');
  if (!validProviderId(subscriptionId) || !validProviderId(customerId)) return false;

  const { response, payload } = await asaasFetch(
    env,
    `/subscriptions?customer=${encodeURIComponent(customerId)}&deletedOnly=true&limit=100`,
    { method: 'GET' },
    environment,
  );
  if (!response?.ok || !Array.isArray(payload?.data)) {
    throw Object.assign(new Error('asaas_deleted_subscription_verification_unavailable'), { status: 502 });
  }
  const found = payload.data.some((item) => String(item?.id || '') === subscriptionId);
  if (!found && payload?.hasMore) {
    throw Object.assign(new Error('asaas_deleted_subscription_verification_pagination_required'), { status: 502 });
  }
  return found;
}

async function cancelProviderSubscription(env, subscription, environment = 'production') {
  const subscriptionId = String(subscription.external_subscription_id || '');
  if (!validProviderId(subscriptionId)) throw Object.assign(new Error('invalid_external_subscription_id'), { status: 409 });

  const { response, payload } = await asaasFetch(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: 'DELETE' },
    environment,
  );
  if (response?.ok) return { alreadyDeleted: false };
  if (response?.status === 404 && await confirmedDeletedAtProvider(env, subscription, environment)) {
    return { alreadyDeleted: true };
  }
  throw Object.assign(new Error(payload?.errors?.[0]?.description || 'asaas_subscription_delete_failed'), {
    status: response?.status && response.status < 500 ? 409 : 502,
  });
}

async function getSubscriptionState(request, env, environment = 'production') {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'unauthorized' });
  const subscription = await localSubscription(env, user.id, environment);
  return json(200, subscriptionCancellationState(subscription));
}

async function cancelSubscription(request, env, environment = 'production') {
  const user = await authenticateClinicalRequest(request, env);
  if (!user?.id) return json(401, { error: 'unauthorized' });

  const provider = providerFor(environment);
  const claimKey = `payment-owner:${provider}:${user.id}`;
  const claim = await acquireClaim(env, claimKey);
  if (!claim) return json(409, { error: 'subscription_change_in_progress' });

  try {
    let subscription = await localSubscription(env, user.id, environment);
    if (!subscription) return json(404, { error: 'subscription_not_found' });
    if (subscription.plan_code !== 'pro_monthly' || !subscription.external_subscription_id) {
      return json(409, { error: 'subscription_not_recurring' });
    }

    let state = subscriptionCancellationState(subscription);
    if (state.cancelAtPeriodEnd) return json(200, state);
    if (!state.currentPeriodEnd) return json(409, { error: 'subscription_period_unknown' });
    if (!state.canCancel) return json(409, { error: 'subscription_not_cancellable' });

    const providerResult = await cancelProviderSubscription(env, subscription, environment);
    const now = new Date().toISOString();
    subscription = await saveCancellationMetadata(env, subscription, {
      cancel_at_period_end: true,
      cancellation_requested_at: now,
      provider_deleted_at: now,
      cancellation_source: 'self_service',
      provider_subscription_status: 'DELETED',
      provider_delete_reconciled: providerResult.alreadyDeleted === true,
    });
    state = subscriptionCancellationState(subscription);
    return json(200, state);
  } finally {
    await releaseClaim(env, claimKey, claim);
  }
}

async function beginWebhookEvent(env, { provider, externalEventId, eventType, paymentId, checkoutId, payload }) {
  const result = await db(env).prepare(`INSERT INTO billing_webhook_events(
    id,provider,external_event_id,event_type,status,payment_id,checkout_request_id,payload_json,received_at
  ) VALUES(?,?,?,?, 'received',?,?,?,CURRENT_TIMESTAMP)
  ON CONFLICT(provider,external_event_id) DO NOTHING`)
    .bind(crypto.randomUUID(), provider, externalEventId, eventType, paymentId || null, checkoutId || null, JSON.stringify(payload || {})).run();
  if (Number(result?.meta?.changes || 0) > 0) return { duplicate: false };
  const existing = await db(env).prepare('SELECT status FROM billing_webhook_events WHERE provider=? AND external_event_id=? LIMIT 1')
    .bind(provider, externalEventId).first();
  if (existing?.status === 'processed') return { duplicate: true };
  await db(env).prepare(`UPDATE billing_webhook_events SET status='received',error_message=NULL,processed_at=NULL
    WHERE provider=? AND external_event_id=?`).bind(provider, externalEventId).run();
  return { duplicate: false };
}

async function finishWebhookEvent(env, provider, externalEventId, ok, error = null) {
  await db(env).prepare(`UPDATE billing_webhook_events SET status=?,processed_at=?,error_message=?
    WHERE provider=? AND external_event_id=?`)
    .bind(ok ? 'processed' : 'failed', new Date().toISOString(), error, provider, externalEventId).run();
}

async function verifyWebhookBoundary(request, env, subscription, environment = 'production') {
  const expectedToken = webhookToken(env, environment);
  if (expectedToken) return safeEqual(request.headers.get('asaas-access-token'), expectedToken);
  return confirmedDeletedAtProvider(env, subscription, environment);
}

async function handleSubscriptionDeletedWebhook(request, env, incoming, environment = 'production') {
  const subscriptionId = String(incoming?.subscription?.id || '');
  if (!validProviderId(subscriptionId)) return json(400, { error: 'invalid_subscription_id' });
  let subscription = await subscriptionByExternalId(env, subscriptionId, environment);
  if (!subscription) return json(200, { status: 'ignored_unmapped_subscription', environment });
  if (!await verifyWebhookBoundary(request, env, subscription, environment)) {
    return json(401, { error: 'invalid_webhook_token' });
  }

  const provider = providerFor(environment);
  const eventId = String(incoming?.id || `subscription:${subscriptionId}:DELETED`);
  const event = await beginWebhookEvent(env, {
    provider,
    externalEventId: eventId,
    eventType: 'SUBSCRIPTION_DELETED',
    paymentId: null,
    checkoutId: subscription.origin_checkout_request_id || null,
    payload: { environment, subscription_id: subscriptionId, provider_status: 'DELETED' },
  });
  if (event.duplicate) return json(200, { status: 'duplicate_ignored', eventId, environment });

  const claimKey = `payment-owner:${provider}:${subscription.owner_id}`;
  const claim = await acquireClaim(env, claimKey);
  if (!claim) return json(503, { error: 'event_in_progress' });
  try {
    const now = new Date().toISOString();
    subscription = await saveCancellationMetadata(env, subscription, {
      cancel_at_period_end: true,
      cancellation_requested_at: metadataFor(subscription).cancellation_requested_at || now,
      provider_deleted_at: now,
      cancellation_source: metadataFor(subscription).cancellation_source || 'provider_event',
      provider_subscription_status: 'DELETED',
    });
    await expireCancelledSubscription(env, subscription, environment);
    await finishWebhookEvent(env, provider, eventId, true);
    return json(200, { status: 'processed', eventId, environment });
  } catch (error) {
    await finishWebhookEvent(env, provider, eventId, false, String(error?.message || error).slice(0, 1000));
    return json(500, { error: 'subscription_event_apply_failed', eventId });
  } finally {
    await releaseClaim(env, claimKey, claim);
  }
}

async function handleCancelledRecurringPaymentDeletion(request, env, incoming, environment = 'production') {
  const payment = incoming?.payment || {};
  const paymentId = String(payment.id || '');
  const subscriptionId = String(payment.subscription || '');
  if (!validProviderId(paymentId) || !validProviderId(subscriptionId)) return null;

  const subscription = await subscriptionByExternalId(env, subscriptionId, environment);
  if (!subscription || !shouldPreserveCancelledRecurringAccess(subscription, 'DELETED')) return null;
  if (!await verifyWebhookBoundary(request, env, subscription, environment)) {
    return json(401, { error: 'invalid_webhook_token' });
  }

  const provider = providerFor(environment);
  const externalEventId = `payment:${paymentId}:DELETED`;
  const event = await beginWebhookEvent(env, {
    provider,
    externalEventId,
    eventType: 'PAYMENT_DELETED',
    paymentId,
    checkoutId: subscription.origin_checkout_request_id || null,
    payload: {
      environment,
      payment_id: paymentId,
      subscription_id: subscriptionId,
      preserved_until: subscription.current_period_end,
      reason: 'recurring_subscription_cancelled_at_period_end',
    },
  });
  if (!event.duplicate) await finishWebhookEvent(env, provider, externalEventId, true);
  return json(200, {
    status: event.duplicate ? 'duplicate_ignored' : 'ignored_cancelled_recurring_payment',
    paymentId,
    currentPeriodEnd: subscription.current_period_end,
    environment,
  });
}

async function handleWebhookExtension(request, env, url) {
  if (request.method !== 'POST') return null;
  const environment = url.pathname === '/api/sandbox/webhooks/asaas' ? 'sandbox' : 'production';
  const incoming = await request.clone().json().catch(() => null);
  const eventName = String(incoming?.event || '').toUpperCase();
  if (eventName === 'SUBSCRIPTION_DELETED') {
    return handleSubscriptionDeletedWebhook(request, env, incoming, environment);
  }
  if (eventName === 'PAYMENT_DELETED') {
    return handleCancelledRecurringPaymentDeletion(request, env, incoming, environment);
  }
  return null;
}

export async function reconcileSubscriptionCancellations(env, { limit = 20 } = {}) {
  if (!env.CLINICAL_DB) return;
  const result = await db(env).prepare(`SELECT * FROM subscriptions
    WHERE provider='asaas' AND status IN ('active','trialing','past_due')
      AND current_period_end IS NOT NULL
      AND julianday(current_period_end)<=julianday('now')
      AND json_extract(metadata_json,'$.cancel_at_period_end')=1
    ORDER BY current_period_end ASC LIMIT ?`).bind(Math.min(50, Math.max(1, limit))).all();

  for (const subscription of result.results || []) {
    const claimKey = `payment-owner:asaas:${subscription.owner_id}`;
    const claim = await acquireClaim(env, claimKey, 60000);
    if (!claim) continue;
    try {
      await expireCancelledSubscription(env, subscription, 'production');
    } catch (error) {
      console.error('subscription cancellation expiry failed', JSON.stringify({
        ownerId: subscription.owner_id,
        subscriptionId: subscription.external_subscription_id || null,
        error: String(error?.message || error),
      }));
    } finally {
      await releaseClaim(env, claimKey, claim);
    }
  }
}

export async function handleSubscriptionCancellationRuntime(request, env, url = new URL(request.url)) {
  if (!env.CLINICAL_DB) return null;

  if (url.pathname === '/api/asaas/subscription' && request.method === 'GET') {
    return getSubscriptionState(request, env, 'production');
  }
  if (url.pathname === '/api/asaas/subscription/cancel' && request.method === 'POST') {
    try {
      return await cancelSubscription(request, env, 'production');
    } catch (error) {
      return json(error?.status || 503, {
        error: error?.message || 'subscription_cancel_failed',
      });
    }
  }
  if (url.pathname === '/api/webhooks/asaas' || url.pathname === '/api/sandbox/webhooks/asaas') {
    try {
      return await handleWebhookExtension(request, env, url);
    } catch (error) {
      return json(error?.status || 503, {
        error: 'subscription_webhook_extension_failed',
        details: error?.message || String(error),
      });
    }
  }
  return null;
}
