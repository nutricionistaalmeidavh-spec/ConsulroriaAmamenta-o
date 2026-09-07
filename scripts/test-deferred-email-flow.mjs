import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { join } from 'node:path';
const readSource = path => readFileSync(join(process.env.SOURCE_ROOT || '.', path), 'utf8');
import worker from '../worker/index.js';

const id = '11111111-1111-4111-8111-111111111111';
const nonce = 'a'.repeat(64);
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
function edge(file, fetch, extra = {}) {
  let handler;
  const source = readSource(file).replace(/^import .*post-payment-email.ts';\n/m, '').replace('export async function', 'async function');
  const context = vm.createContext({ Request, Response, URL, TextEncoder, crypto, fetch,
    Deno: { env: { get: (name) => name === 'SUPABASE_URL' ? 'https://auth.test' : 'test-key' }, serve: (h) => { handler = h; } }, ...extra });
  vm.runInContext(stripTypeScriptTypes(source), context);
  return { request: async (body, headers = {}) => handler(new Request('https://edge.test', { method: 'POST', headers, body: JSON.stringify(body) })), context };
}
let calls = [];
let authError = 'invalid_credentials';
let prior = [];
const fakeFetch = async (url, options = {}) => {
  calls.push({ url, options });
  const body = JSON.parse(options.body || '{}');
  if (url.includes('/token?')) return reply({ error_code: authError }, authError === 'rate_limit' ? 429 : 400);
  if (url.endsWith('/rpc/commercial_pending_user_id')) return reply(id);
  if (url.endsWith('/auth/v1/admin/users') && options.method === 'POST') {
    assert.equal(body.email_confirm, false);
    return reply({ id });
  }
  if (url.includes('/auth/v1/admin/users/')) return reply({ id, email: 'test@example.com',
    app_metadata: { checkout_email_after_payment: true, checkout_nonce: nonce } });
  if (url.includes('billing_checkout_requests?owner_id')) return reply(prior);
  if (url.includes('billing_plan_catalog')) return reply([{ plan_code: 'pro_monthly' }]);
  if (url.includes('saas_accounts')) return reply([{ id, owner_id: id }]);
  if (url.includes('billing_checkout_requests?select')) return reply([{ id }]);
  throw new Error(`Unexpected call ${url}`);
};
const checkout = edge('supabase/functions/saas-checkout/index.ts', fakeFetch, { sendPaidConfirmation: async () => ({ ok: true, status: 'awaiting_payment' }) });
let r = await checkout.request({ action: 'prepare_signup', email: 'test@example.com', password: 'long-password', planCode: 'pro_monthly' });
assert.equal(r.status, 200);
assert.equal((await r.json()).signupNonce, nonce);
assert.ok(calls.some(c => c.url.endsWith('/auth/v1/admin/users')));
assert.ok(!calls.some(c => /\/signup|\/resend/.test(c.url)), 'No email API before payment');

calls = []; authError = 'email_not_confirmed';
r = await checkout.request({ action: 'prepare_signup', email: 'test@example.com', password: 'long-password', planCode: 'pro_monthly' });
assert.equal(r.status, 200);
assert.ok(!calls.some(c => c.options.method === 'PUT' || c.url.endsWith('/auth/v1/admin/users')), 'Existing account is not recreated or reset');

calls = []; authError = 'rate_limit';
r = await checkout.request({ action: 'prepare_signup', email: 'test@example.com', password: 'long-password', planCode: 'pro_monthly' });
assert.equal(r.status, 429); assert.equal(calls.length, 1);
calls = []; authError = 'captcha_failed';
r = await checkout.request({ action: 'prepare_signup', email: 'test@example.com', password: 'long-password', planCode: 'pro_monthly' });
assert.equal(r.status, 400); assert.equal(calls.length, 1);

const request = { action: 'create_pending_request', userId: id, signupNonce: nonce, planCode: 'pro_monthly' };
r = await checkout.request({ ...request, signupNonce: 'b'.repeat(64) }); assert.equal(r.status, 401);
prior = [{ id, status: 'checkout_created', plan_code: 'pro_monthly', checkout_url: 'https://asaas.com/checkoutSession/show?id=test' }];
calls = []; r = await checkout.request(request);
assert.equal((await r.json()).checkoutUrl, prior[0].checkout_url);
assert.ok(!calls.some(c => c.options.method === 'POST'));
prior[0].status = 'pending_provider'; r = await checkout.request(request); assert.equal(r.status, 409);
prior[0].status = 'paid'; r = await checkout.request(request); assert.equal((await r.json()).status, 'paid');

// The Worker must not create a second provider checkout for a resumed purchase.
const originalFetch = globalThis.fetch;
try {
  let providerCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.includes('/functions/')) return reply({ status: 'checkout_created', checkoutUrl: 'https://asaas.com/checkoutSession/show?id=test' });
    providerCalls++; throw new Error('Unexpected provider creation');
  };
  r = await worker.fetch(new Request('https://app.test/api/asaas/preauth-checkout', { method: 'POST', body: JSON.stringify(request) }), { ASAAS_SECRET: 'test' });
  assert.equal(r.status, 200); assert.equal(providerCalls, 0);
} finally { globalThis.fetch = originalFetch; }

// Payment/email ordering and delivery retry use server state, never the browser redirect.
let paid = false; let sent = false; let deliveryFails = false; let mailCalls = 0;
const emailModule = edge('supabase/functions/_shared/post-payment-email.ts', async (url, options = {}) => {
  if (url.includes('billing_checkout_requests')) return reply(paid ? [{ plan_code: 'pro_monthly' }] : []);
  if (url.includes('/resend')) { mailCalls++; return reply({}, deliveryFails ? 429 : 200); }
  if (options.method === 'PUT') { sent = true; return reply({}); }
  return reply({ email: 'test@example.com', app_metadata: { checkout_email_after_payment: true, checkout_confirmation_sent_at: sent ? 'now' : null } });
});
const send = emailModule.context.sendPaidConfirmation;
assert.equal((await send('https://auth.test', 'key', id)).status, 'awaiting_payment'); assert.equal(mailCalls, 0);
paid = true; deliveryFails = true;
assert.equal((await send('https://auth.test', 'key', id)).ok, false); assert.equal(sent, false);
deliveryFails = false; assert.equal((await send('https://auth.test', 'key', id)).status, 'email_sent');
await send('https://auth.test', 'key', id); assert.equal(mailCalls, 2, 'Duplicate payment does not resend');

// Execute the actual form submit callback. Pro must never reach the public signup endpoint.
const app = readSource('public/comercial/app.js');
const start = app.indexOf("document.querySelector('#signup-form').addEventListener('submit', ");
const end = app.indexOf("\ndocument.querySelector('#login-form')", start);
let submit; let wentToCheckout = false;
const formContext = vm.createContext({
  document: { querySelector: () => ({ addEventListener: (_, cb) => { submit = cb; } }) },
  FormData: class { get(key) { return ({ email: 'test@example.com', password: 'long-password', confirmPassword: 'long-password', planIntent: 'pro_monthly' })[key]; } },
  sessionStorage: { setItem() {} }, PLAN_KEY: 'plan', PENDING_SIGNUP_KEY: 'proof', selectedPlan: '',
  generateSignupNonce: () => nonce, setBusy() {}, setMessage(text, tone) { if (tone === 'error') throw new Error(text); },
  friendlyError: e => e.message, fetch: async url => { assert.equal(url, '/api/asaas/signup'); return reply({ userId: id, signupNonce: nonce }); },
  startPreconfirmCheckout: async () => { wentToCheckout = true; },
  request: () => { throw new Error('Public signup must not run for Pro'); },
});
vm.runInContext(app.slice(start, end), formContext);
await submit({ preventDefault() {}, currentTarget: {} });
assert.equal(wentToCheckout, true);
console.log('Deferred email flow: new/recovered signup, rate limits, proof, resume, paid gate, delivery retry and Pro form OK');

// Exercise the webhook entrypoint: pending payments and sandbox never request mail;
// a duplicate approved event retries mail without applying billing a second time.
let paymentStatus = 'PENDING'; let duplicate = false; let billingWrites = 0; let emails = 0;
let emailFailure = false; let checkoutPaid = false;
const billing = edge('supabase/functions/saas-billing-webhook/index.ts', async (url, options = {}) => {
  if (url.includes('/payments?')) return reply({ data: [{ id: 'pay_test' }] });
  if (url.includes('/payments/')) return reply({ id: 'pay_test', status: paymentStatus, externalReference: `saas_checkout:${id}` });
  if (url.includes('billing_checkout_requests')) {
    if (options.method === 'PATCH') { checkoutPaid = true; return reply({}); }
    return reply([{ id, owner_id: id, plan_code: 'pro_monthly', external_checkout_id: 'check_test' }]);
  }
  if (url.includes('billing_webhook_events')) {
    if (options.method === 'POST') return reply(duplicate ? [] : [{ id }]);
    if (options.method === 'PATCH') return reply({});
    return reply([{ status: 'processed' }]);
  }
  if (url.includes('apply_billing_state')) { billingWrites++; return reply({}); }
  throw new Error(`Unexpected billing URL ${url}`);
}, { sendPaidConfirmation: async () => {
  assert.equal(checkoutPaid, true, 'Payment persisted before email');
  emails++; return { ok: !emailFailure, status: 'email_delivery_pending' };
} });
const billingRequest = (source = 'cloudflare-asaas') => billing.request({ paymentId: 'pay_test' }, { 'x-asaas-api-key': 'test', 'x-billing-source': source });
r = await billingRequest(); assert.equal(r.status, 200); assert.equal(emails, 0);
paymentStatus = 'CONFIRMED'; emailFailure = true;
r = await billingRequest(); assert.equal(r.status, 503); assert.equal(billingWrites, 1); assert.equal(emails, 1);
duplicate = true; emailFailure = false;
r = await billingRequest(); assert.equal(r.status, 200); assert.equal(billingWrites, 1); assert.equal(emails, 2);
duplicate = false; r = await billingRequest('cloudflare-asaas-sandbox'); assert.equal(r.status, 200); assert.equal(emails, 2);
console.log('Webhook: approval gate, persisted payment, email retry without rebilling, sandbox isolation OK');
