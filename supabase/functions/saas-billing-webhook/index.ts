import { sendPaidConfirmation } from '../_shared/post-payment-email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-asaas-api-key, x-billing-source',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASAAS_API_URL = 'https://api.asaas.com/v3';
const ASAAS_SANDBOX_API_URL = 'https://api-sandbox.asaas.com/v3';

type JsonRecord = Record<string, unknown>;

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

  // The Edge Function independently reads the payment from the matching Asaas environment.
  const { response: paymentResponse, payload: payment } = await asaasFetch(
    apiKey,
    `/payments/${encodeURIComponent(paymentId)}`,
    environment,
  );
  if (paymentResponse.status === 401 || paymentResponse.status === 403) {
    return json(401, { error: 'asaas_api_key_rejected' });
  }
  if (paymentResponse.status === 404) return json(200, { status: 'ignored_payment_not_found', environment });
  if (!paymentResponse.ok || String(payment?.id || '') !== paymentId) {
    return json(502, { error: 'asaas_payment_verification_failed' });
  }

  const requestId = parseCheckoutReference(payment?.externalReference);
  if (!requestId) return json(200, { status: 'ignored_unmapped_payment', paymentId, environment });

  const checkoutResponse = await serviceFetch(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}&select=id,account_id,owner_id,plan_code,status,external_checkout_id&limit=1`,
  );
  const checkoutRows = await checkoutResponse.json().catch(() => []);
  const checkoutRequest = Array.isArray(checkoutRows) ? checkoutRows[0] : null;
  if (!checkoutResponse.ok) return json(500, { error: 'checkout_lookup_failed' });
  if (!checkoutRequest?.external_checkout_id) {
    return json(200, { status: 'ignored_unknown_checkout', paymentId, environment });
  }

  // The supplied key must list this exact payment under the exact checkout session stored for this environment.
  const { response: checkoutPaymentsResponse, payload: checkoutPayments } = await asaasFetch(
    apiKey,
    `/payments?checkoutSession=${encodeURIComponent(checkoutRequest.external_checkout_id)}&limit=100`,
    environment,
  );
  if (!checkoutPaymentsResponse.ok) return json(401, { error: 'checkout_account_verification_failed' });
  const checkoutPaymentRows = Array.isArray(checkoutPayments?.data) ? checkoutPayments.data : [];
  let belongsToOurCheckout = checkoutPaymentRows.some((item: JsonRecord) => String(item?.id || '') === paymentId);

  const externalSubscriptionId = payment?.subscription ? String(payment.subscription) : '';
  if (!belongsToOurCheckout && externalSubscriptionId) {
    const subscriptionResponse = await serviceFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/subscriptions?owner_id=eq.${encodeURIComponent(checkoutRequest.owner_id)}&provider=eq.${encodeURIComponent(provider)}&external_subscription_id=eq.${encodeURIComponent(externalSubscriptionId)}&plan_code=eq.${encodeURIComponent(checkoutRequest.plan_code)}&select=id&limit=1`,
    );
    const subscriptionRows = await subscriptionResponse.json().catch(() => []);
    belongsToOurCheckout = subscriptionResponse.ok && Array.isArray(subscriptionRows) && subscriptionRows.length === 1;
  }

  if (!belongsToOurCheckout) return json(401, { error: 'payment_not_from_registered_checkout' });

  const providerStatus = String(payment?.status || '').toUpperCase();
  const transition = billingTransition(providerStatus);
  if (!transition) {
    return json(200, { status: 'ignored_no_billing_transition', paymentId, providerStatus, environment });
  }

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
          checkout_request_id: requestId,
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
      if (environment === 'production' && transition === 'active') {
        const email = await sendPaidConfirmation(supabaseUrl, serviceKey, checkoutRequest.owner_id);
        if (!email.ok) return json(503, { error: email.status, eventId });
      }
      return json(200, { status: 'duplicate_ignored', eventId, environment });
    }
    // A failed application may be retried; never mark an email-delivery failure as a billing failure.
  }

  const rpcResponse = await serviceFetch(
    supabaseUrl,
    serviceKey,
    '/rest/v1/rpc/apply_billing_state',
    {
      method: 'POST',
      body: JSON.stringify({
        p_owner_id: checkoutRequest.owner_id,
        p_plan_code: checkoutRequest.plan_code,
        p_status: transition,
        p_provider: provider,
        p_external_subscription_id: externalSubscriptionId || null,
        p_current_period_end: transition === 'active' ? addPlanPeriod(checkoutRequest.plan_code) : null,
        p_metadata: {
          source: metadataSource,
          environment,
          external_event_id: eventId,
          checkout_request_id: requestId,
          payment_id: paymentId,
          provider_status: providerStatus,
        },
      }),
    },
  );

  let processed = rpcResponse.ok;
  let rpcError = processed ? null : (await rpcResponse.text()).slice(0, 1000);

  if (processed && (transition === 'active' || transition === 'cancelled')) {
    const checkoutUpdate = await serviceFetch(
      supabaseUrl,
      serviceKey,
      `/rest/v1/billing_checkout_requests?id=eq.${encodeURIComponent(requestId)}&provider=eq.${encodeURIComponent(provider)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: transition === 'active' ? 'paid' : 'cancelled',
          updated_at: new Date().toISOString(),
        }),
      },
    );
    if (!checkoutUpdate.ok) { processed = false; rpcError = 'checkout_status_update_failed'; }
  }


  await serviceFetch(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_webhook_events?provider=eq.${encodeURIComponent(provider)}&external_event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: processed ? 'processed' : 'failed',
        processed_at: new Date().toISOString(),
        error_message: rpcError,
      }),
    },
  );

  if (!processed) return json(500, { error: 'billing_state_apply_failed', eventId });

  if (environment === 'production' && transition === 'active') {
    const email = await sendPaidConfirmation(supabaseUrl, serviceKey, checkoutRequest.owner_id);
    if (!email.ok) return json(503, { error: email.status, eventId });
  }

  return json(200, {
    status: 'processed',
    eventId,
    paymentId,
    planCode: checkoutRequest.plan_code,
    billingStatus: transition,
    environment,
  });
});
