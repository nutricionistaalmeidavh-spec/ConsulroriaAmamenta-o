import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const ownerId = '11111111-1111-4111-8111-111111111111';
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' },
});

let handler;
let paymentId = 'pay_renewal';
let duplicate = false;
let knownSubscription = true;
let billingWrites = 0;
let checkoutLookups = 0;
let partnerWrites = 0;
let emailCalls = 0;

const fakeFetch = async (url, options = {}) => {
  const href = String(url);
  const method = options.method || 'GET';

  if (href.includes(`/payments/${paymentId}`)) {
    return reply({
      id: paymentId,
      status: 'CONFIRMED',
      subscription: 'sub_monthly_123',
      externalReference: null,
    });
  }

  if (href.includes('/rest/v1/subscriptions?provider=eq.asaas&external_subscription_id=eq.sub_monthly_123')) {
    return reply(knownSubscription
      ? [{ id: 'sub-row', owner_id: ownerId, plan_code: 'pro_monthly', current_period_end: null }]
      : []);
  }

  if (href.includes('/rest/v1/subscriptions?owner_id=')) {
    return reply([{ current_period_end: '2026-10-22T00:00:00.000Z' }]);
  }

  if (href.includes('/rest/v1/billing_checkout_requests')) {
    checkoutLookups += 1;
    throw new Error('Recurring renewals must not require the original checkout request');
  }

  if (href.includes('/rest/v1/billing_webhook_events?on_conflict=')) {
    return reply(duplicate ? [] : [{ id: 'event-row' }]);
  }

  if (href.includes('/rest/v1/billing_webhook_events?provider=')) {
    if (method === 'PATCH') return reply({});
    return reply([{ status: 'processed' }]);
  }

  if (href.includes('/rest/v1/rpc/apply_billing_state')) {
    billingWrites += 1;
    const body = JSON.parse(options.body || '{}');
    assert.equal(body.p_owner_id, ownerId);
    assert.equal(body.p_plan_code, 'pro_monthly');
    assert.equal(body.p_external_subscription_id, 'sub_monthly_123');
    assert.equal(body.p_metadata.mapping, 'subscription');
    assert.equal(body.p_metadata.checkout_request_id, null);
    return reply({});
  }

  if (href.includes('/rest/v1/rpc/apply_partner_attribution_state')) {
    partnerWrites += 1;
    throw new Error('Recurring renewal must not create another first-sale partner commission');
  }

  throw new Error(`Unexpected recurring billing URL ${href}`);
};

const source = readFileSync('supabase/functions/saas-billing-webhook/index.ts', 'utf8')
  .replace(/^import .*post-payment-email.ts';\n/m, '')
  .replace('export async function', 'async function');

const context = vm.createContext({
  Request,
  Response,
  URL,
  TextEncoder,
  crypto,
  fetch: fakeFetch,
  sendPaidConfirmation: async () => {
    emailCalls += 1;
    return { ok: true, status: 'email_sent' };
  },
  Deno: {
    env: {
      get: (name) => name === 'SUPABASE_URL' ? 'https://auth.test' : 'test-key',
    },
    serve: (fn) => { handler = fn; },
  },
});
vm.runInContext(stripTypeScriptTypes(source), context);

function request(sourceHeader = 'cloudflare-asaas') {
  return handler(new Request('https://edge.test', {
    method: 'POST',
    headers: {
      'x-asaas-api-key': 'test-key',
      'x-billing-source': sourceHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ paymentId }),
  }));
}

let response = await request();
assert.equal(response.status, 200);
let payload = await response.json();
assert.equal(payload.status, 'processed');
assert.equal(payload.mappedBy, 'subscription');
assert.equal(payload.ownerId, ownerId);
assert.equal(billingWrites, 1);
assert.equal(checkoutLookups, 0);
assert.equal(partnerWrites, 0);
assert.equal(emailCalls, 0, 'Recurring renewals do not resend first-purchase confirmation email');

// Idempotency: the same verified payment/status must not apply billing twice.
duplicate = true;
response = await request();
assert.equal(response.status, 200);
payload = await response.json();
assert.equal(payload.status, 'duplicate_ignored');
assert.equal(payload.mappedBy, 'subscription');
assert.equal(billingWrites, 1);
assert.equal(partnerWrites, 0);
assert.equal(emailCalls, 0);

// An unknown subscription cannot activate anyone.
duplicate = false;
knownSubscription = false;
paymentId = 'pay_unknown_subscription';
response = await request();
assert.equal(response.status, 200);
payload = await response.json();
assert.equal(payload.status, 'ignored_unmapped_payment');
assert.equal(billingWrites, 1);

console.log('Asaas recurring renewal: maps by persisted subscription id, stays idempotent, and does not duplicate first-sale commission/email.');
