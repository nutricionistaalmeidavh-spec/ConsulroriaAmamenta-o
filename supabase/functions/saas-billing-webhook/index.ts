import { sendPaidConfirmation } from '../_shared/post-payment-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-asaas-api-key, x-billing-source',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_SANDBOX_API_URL = 'https://api-sandbox.asaas.com/v3';

type JsonRecord = Record<string, unknown>;

type BillingContext = {
  ownerId: string;
  planCode: string;
  requestId: string | null;
  externalCheckoutId: string | null;
  mappedBy: 'checkout' | 'subscription';
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function serviceFetch(url: string, serviceKey: string, path: string, options: RequestInit = {}) {
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

function billingEnvironment(source: string) {
  if (source === 'cloudflare-asaas') return 'production';
  if (source === 'cloudflare-asaas-sandbox') return 'sandbox';
  return null;
}

async function asaasFetch(apiKey: string, path: string, environment: string) {
  const apiUrl = environment === 'sandbox' ? ASAAS_SANDBOX_API_URL : ASAAS_API_URL;
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'GET',
    headers: {
      access_token: apiKey,
      accept: 'application/json',
      'user-agent': `ConsultoriaAmamentacao/1.0 (${environment})`,
    },
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function parseCheckoutReference(value: unknown) {
  const match = String(value || '').match(/^saas_checkout:([0-9a-f-]{36})$/i);
  return match ? match[1] : null;
}

function billingTransition(status: unknown) {
  const normalized = String(status || '').toUpperCase();
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(normalized)) return 'active';
  if (normalized === 'OVERDUE') return 'past_due';
  if ([
    'REFUNDED',
    'REFUND_REQUESTED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL',
    'DELETED',
  ].includes(normalized)) return 'cancelled';
  return null;
}

function addPlanPeriod(planCode: string) {
  const date = new Date();
  if (planCode === 'pro_annual') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

async function storedPeriodEnd(url: string, serviceKey: string, ownerId: string, provider: string, planCode: string) {
  const response = await serviceFetch(
    url,
    serviceKey,
    `/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(ownerId)}&provider=eq.${encodeURIComponent(provider)}&plan_code=eq.${encodeURIComponent(planCode)}&select=current_period_end&order=updated_at.desc&limit=1`,
  );
  const rows = await response.json().catch(() => []);
  return response.ok && Array.isArray(rows) ? rows[0]?.current_period_end || null : null;
}

async function subscriptionContext(
  supabaseUrl: string,
  serviceKey: string,
  provider: string,
  externalSubscriptionId: string,
) {
  if (!externalSubscriptionId) return null;
  const response = await serviceFetch(
    supabaseUrl,
    serviceKey,
    `/rest/v1/subscriptions?provider=eq.${encodeURIComponent(provider)}&external_subscription_id=eq.${encodeURIComponent(externalSubscriptionId)}&select=id,owner_id,plan_code,current_period_end&limit=2`,
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (!row?.owner_id || !row?.plan_code) return null;
  return {
    ownerId: String(row.owner_id),
    planCode: String(row.plan_code),
    requestId: null,
    externalCheckoutId: null,
    mappedBy: 'subscription' as const,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const apiKey = req.headers.get('x-asaas-api-key') || '';
  const source = req.headers.get('x-billing-source') || '';
  const environment = billingEnvironment(source);
  if (!supabaseUrl || !serviceKey) return json(503, { error: 'server_not_configured' });
  if (!apiKey || !environment) return json(401, { error: 'billing_bridge_unauthorized' });

  const provider = environment === 'sandbox' ? 'asaas_sandbox' : 'asaas';
  const metadataSource = environment === 'sandbox'
    ? 'cloudflare_asaas_sandbox_verified_payment'
    : 'cloudflare_asaas_verified_payment';

  const body = await req.json().catch(() => null);
  const paymentId = String(body?.paymentId || '');
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(paymentId)) return json(400, { error: 'invalid_payment_id' });

  const { response: paymentResponse, payload: payment } = await asaasFetch(
    apiKey,
    `/payments/${encodeURIComponent(paymentId)}`,
    environment,
  );
  if (paymentResponse.status === 401 || paymentResponse.status === 403) return json(401, { error: 'asaas_api_key_rejected' });
  if (paymentResponse.status === 404) return json(200, { status: 'ignored_payment_not_found', environment });
  if (!paymentResponse.ok || String(payment?.id || '') !== paymentId) return json(502, { error: 'asaas_payment_verification_failed' });

  const externalSubscriptionId = payment?.subscription ? String(payment.subscription) : '';
  const requestId = parseCheckoutReference(payment?.externalReference);
  let context: BillingContext | null = null;

  if (requestId) {
    const checkoutResponse = await serviceFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}&select=id,account_id,owner_id,plan_code,status,external_checkout_id&limit=1`,
    );
    const checkoutRows = await checkoutResponse.json().catch(() => []);
    const checkoutRequest = Array.isArray(checkoutRows) ? checkoutRows[0] : null;
    if (!checkoutResponse.ok) return json(500, { error: 'checkout_lookup_failed' });
    if (!checkoutRequest?.external_checkout_id) return json(200, { status: 'ignored_unknown_checkout', paymentId, environment });

    const { response: checkoutPaymentsResponse, payload: checkoutPayments } = await asaasFetch(
      apiKey,
      `/payments?checkoutSession=${encodeURIComponent(checkoutRequest.external_checkout_id)}&limit=100`,
      environment,
    );
    if (!checkoutPaymentsResponse.ok) return json(401, { error: 'checkout_account_verification_failed' });
    const checkoutPaymentRows = Array.isArray(checkoutPayments?.data) ? checkoutPayments.data : [];
    let belongsToOurCheckout = checkoutPaymentRows.some((item: JsonRecord) => String(item?.id || '') === paymentId);

    if (!belongsToOurCheckout && externalSubscriptionId) {
      const knownSubscription = await subscriptionContext(supabaseUrl, serviceKey, provider, externalSubscriptionId);
      belongsToOurCheckout = Boolean(
        knownSubscription
        && knownSubscription.ownerId === String(checkoutRequest.owner_id)
        && knownSubscription.planCode === String(checkoutRequest.plan_code),
      );
    }
    if (!belongsToOurCheckout) return json(401, { error: 'payment_not_from_registered_checkout' });

    context = {
      ownerId: String(checkoutRequest.owner_id),
      planCode: String(checkoutRequest.plan_code),
      requestId,
      externalCheckoutId: String(checkoutRequest.external_checkout_id),
      mappedBy: 'checkout',
    };
  } else if (externalSubscriptionId) {
    // Recurring charges created after a RECURRENT checkout have their own lifecycle.
    // They may no longer carry the checkout externalReference, so reconcile them by the
    // Asaas subscription ID that was persisted after the first verified payment.
    context = await subscriptionContext(supabaseUrl, serviceKey, provider, externalSubscriptionId);
  }

  if (!context) {
    return json(200, {
      status: 'ignored_unmapped_payment',
      paymentId,
      externalSubscriptionId: externalSubscriptionId || null,
      environment,
    });
  }

  const providerStatus = String(payment?.status || '').toUpperCase();
  const transition = billingTransition(providerStatus);
  if (!transition) return json(200, { status: 'ignored_no_billing_transition', paymentId, providerStatus, environment });
  const currentPeriodEnd = transition === 'active' ? addPlanPeriod(context.planCode) : null;

  const eventId = `payment:${paymentId}:${providerStatus}`;
  const eventResponse = await serviceFetch(
    supabaseUrl,
    serviceKey,
    '/rest/v1/billing_webhook_events?on_conflict=provider,external_event_id&select=id,status',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        provider,
        external_event_id: eventId,
        event_type: `PAYMENT_${providerStatus}`,
        status: 'received',
        payload: {
          source: metadataSource,
          environment,
          payment_id: paymentId,
          checkout_request_id: context.requestId,
          external_subscription_id: externalSubscriptionId || null,
          mapping: context.mappedBy,
          provider_status: providerStatus,
        },
      }),
    },
  );
  if (!eventResponse.ok) return json(500, { error: 'webhook_event_store_failed' });
  const eventRows = await eventResponse.json().catch(() => []);
  if (!Array.isArray(eventRows) || eventRows.length === 0) {
    const existingResponse = await serviceFetch(supabaseUrl, serviceKey,
      `/rest/v1/billing_webhook_events?provider=eq.${encodeURIComponent(provider)}&external_event_id=eq.${encodeURIComponent(eventId)}&select=status&limit=1`);
    const existing = await existingResponse.json().catch(() => []);
    if (!existingResponse.ok || !existing[0]) return json(503, { error: 'event_lookup_failed' });
    if (existing[0].status === 'received') return json(503, { error: 'event_in_progress' });
    if (existing[0].status === 'processed') {
      if (environment === 'production' && transition === 'active' && context.requestId) {
        const email = await sendPaidConfirmation(supabaseUrl, serviceKey, context.ownerId);
        if (!email.ok) return json(503, { error: email.status, eventId });
      }
      return json(200, {
        status: 'duplicate_ignored',
        eventId,
        paymentId,
        ownerId: context.ownerId,
        planCode: context.planCode,
        billingStatus: transition,
        currentPeriodEnd: await storedPeriodEnd(supabaseUrl, serviceKey, context.ownerId, provider, context.planCode),
        mappedBy: context.mappedBy,
        environment,
      });
    }
  }

  const rpcResponse = await serviceFetch(
    supabaseUrl,
    serviceKey,
    '/rest/v1/rpc/apply_billing_state',
    {
      method: 'POST',
      body: JSON.stringify({
        p_owner_id: context.ownerId,
        p_plan_code: context.planCode,
        p_status: transition,
        p_provider: provider,
        p_external_subscription_id: externalSubscriptionId || null,
        p_current_period_end: currentPeriodEnd,
        p_metadata: {
          source: metadataSource,
          environment,
          external_event_id: eventId,
          checkout_request_id: context.requestId,
          external_subscription_id: externalSubscriptionId || null,
          mapping: context.mappedBy,
          payment_id: paymentId,
          provider_status: providerStatus,
        },
      }),
    },
  );

  let processed = rpcResponse.ok;
  let rpcError = processed ? null : (await rpcResponse.text()).slice(0, 1000);

  if (processed && context.requestId && (transition === 'active' || transition === 'cancelled')) {
    const checkoutUpdate = await serviceFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(context.requestId)}&provider=eq.${encodeURIComponent(provider)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: transition === 'active' ? 'paid' : 'cancelled', updated_at: new Date().toISOString() }),
      },
    );
    if (!checkoutUpdate.ok) { processed = false; rpcError = 'checkout_status_update_failed'; }
  }

  if (processed && context.requestId) {
    const attributionResponse = await serviceFetch(
      supabaseUrl,
      serviceKey,
      '/rest/v1/rpc/apply_partner_attribution_state',
      {
        method: 'POST',
        body: JSON.stringify({
          p_checkout_request_id: context.requestId,
          p_provider_status: providerStatus,
        }),
      },
    );
    if (!attributionResponse.ok) { processed = false; rpcError = 'partner_attribution_update_failed'; }
  }

  await serviceFetch(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_webhook_events?provider=eq.${encodeURIComponent(provider)}&external_event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: processed ? 'processed' : 'failed', processed_at: new Date().toISOString(), error_message: rpcError }),
    },
  );

  if (!processed) return json(500, { error: 'billing_state_apply_failed', eventId, details: rpcError || undefined });

  if (environment === 'production' && transition === 'active' && context.requestId) {
    const email = await sendPaidConfirmation(supabaseUrl, serviceKey, context.ownerId);
    if (!email.ok) return json(503, { error: email.status, eventId });
  }

  return json(200, {
    status: 'processed',
    eventId,
    paymentId,
    ownerId: context.ownerId,
    planCode: context.planCode,
    billingStatus: transition,
    currentPeriodEnd,
    mappedBy: context.mappedBy,
    environment,
  });
});
