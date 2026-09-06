const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-billing-provider, x-billing-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(signature));
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const configuredProvider = Deno.env.get('BILLING_PROVIDER') || '';
  const webhookSecret = Deno.env.get('BILLING_WEBHOOK_SECRET') || '';

  if (!supabaseUrl || !serviceKey) return json(503, { error: 'server_not_configured' });
  if (!configuredProvider || !webhookSecret) {
    return json(503, { error: 'billing_provider_not_configured' });
  }

  const provider = req.headers.get('x-billing-provider') || '';
  const signature = (req.headers.get('x-billing-signature') || '').toLowerCase();
  if (provider !== configuredProvider) return json(401, { error: 'provider_mismatch' });

  // This generic adapter intentionally accepts only our canonical HMAC payload.
  // A real Asaas/Kiwify/etc. adapter must normalize and verify that provider's native signature.
  if (provider !== 'generic_hmac') {
    return json(501, { error: 'provider_adapter_not_implemented', provider });
  }

  const rawBody = await req.text();
  const expected = await hmacSha256(webhookSecret, rawBody);
  if (!signature || signature !== expected) return json(401, { error: 'invalid_signature' });

  const payload = JSON.parse(rawBody || '{}');
  const eventId = String(payload?.eventId || '');
  const ownerId = String(payload?.ownerId || '');
  const planCode = String(payload?.planCode || '');
  const status = String(payload?.status || '');
  const externalSubscriptionId = payload?.externalSubscriptionId ? String(payload.externalSubscriptionId) : null;
  const currentPeriodEnd = payload?.currentPeriodEnd ? String(payload.currentPeriodEnd) : null;

  if (!eventId || !ownerId || !['freemium', 'pro_monthly', 'pro_annual'].includes(planCode) || !status) {
    return json(400, { error: 'invalid_canonical_event' });
  }

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
        event_type: String(payload?.eventType || 'billing_state_changed'),
        status: 'received',
        payload,
      }),
    },
  );
  if (!eventResponse.ok) return json(500, { error: 'webhook_event_store_failed' });
  const eventRows = await eventResponse.json().catch(() => []);

  if (!Array.isArray(eventRows) || eventRows.length === 0) {
    return json(200, { status: 'duplicate_ignored', eventId });
  }

  const rpcResponse = await serviceFetch(
    supabaseUrl,
    serviceKey,
    '/rest/v1/rpc/apply_billing_state',
    {
      method: 'POST',
      body: JSON.stringify({
        p_owner_id: ownerId,
        p_plan_code: planCode,
        p_status: status,
        p_provider: provider,
        p_external_subscription_id: externalSubscriptionId,
        p_current_period_end: currentPeriodEnd,
        p_metadata: { source: 'billing_webhook', external_event_id: eventId },
      }),
    },
  );

  const processed = rpcResponse.ok;
  await serviceFetch(
    supabaseUrl,
    serviceKey,
    `/rest/v1/billing_webhook_events?provider=eq.${encodeURIComponent(provider)}&external_event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: processed ? 'processed' : 'failed',
        processed_at: new Date().toISOString(),
        error_message: processed ? null : await rpcResponse.text(),
      }),
    },
  );

  if (!processed) return json(500, { error: 'billing_state_apply_failed', eventId });
  return json(200, { status: 'processed', eventId });
});
