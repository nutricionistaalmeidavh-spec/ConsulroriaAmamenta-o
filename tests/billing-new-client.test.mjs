import test from 'node:test';
import assert from 'node:assert/strict';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { handleCloudflareBillingRuntime, currentPeriodEnd, reconcileBilling, checkoutPayload } from '../worker/cloudflare-billing-runtime.js';
import { handleCloudflareAuthRuntime } from '../worker/cloudflare-auth-runtime.js';
import { cloudflarePasswordHash } from '../worker/cloudflare-auth-compat.js';

const owner = '11111111-1111-4111-8111-111111111111';
const checkoutId = '22222222-2222-4222-8222-222222222222';
const email = 'new-client@example.test';
const free = { productCode: 'debora-lactacao', enforceLimits: true, status: 'freemium', commercial: true, active: false, planCode: 'freemium', patientLimit: 3, mediaUpload: false };
const pro = { productCode: 'debora-lactacao', enforceLimits: true, status: 'active', commercial: true, active: true, planCode: 'pro_monthly', patientLimit: null, mediaUpload: true };
const json = value => Response.json(value);

async function fixture() {
  const db = createSqliteD1();
  let access = { ...free };
  let failLicenseSync = false;
  const env = { CLINICAL_DB: db, ASAAS_SECRET: 'test-only', ASSAS_SANDBOX_SECRET: 'test-sandbox-only', CLINICAL_AUTH_SECRET: 'test-only-secret', LICENSE_SERVICE_SECRET: 'test-only',
    ARTISYS_LICENSING: { fetch: async request => {
      const input = await request.json();
      if (input.action === 'sync') {
        if (failLicenseSync) return new Response('unavailable', { status: 503 });
        access = input.status === 'active' ? { ...pro, planCode: input.planCode, expiresAt: input.expiresAt } : { ...free };
      }
      return json(input.action === 'resolve' ? access : { ok: true });
    } } };
  const salt = Buffer.from('testing-salt').toString('base64url');
  const hash = await cloudflarePasswordHash('Test-password-2026', salt, 100000);
  await db.prepare('INSERT INTO auth_users(user_id,email,app_metadata_json,password_reset_required) VALUES(?,?,?,0)').bind(owner, email, JSON.stringify({ commercial_account: true })).run();
  await db.prepare('INSERT INTO auth_credentials(user_id,password_salt,password_hash) VALUES(?,?,?)').bind(owner, salt, hash).run();
  const login = await handleCloudflareAuthRuntime(new Request('https://app.test/api/auth/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password: 'Test-password-2026' }) }), env);
  const session = await login.json();
  assert.ok(session.access_token, JSON.stringify(session));
  const call = (path, data, authenticated = false) => handleCloudflareBillingRuntime(new Request('https://app.test' + path, {
    method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(authenticated ? { authorization: `Bearer ${session.access_token}` } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  }), env);
  const addCheckout = async (status = 'checkout_created', createdAt = new Date().toISOString(), provider = 'asaas') => db.prepare(`INSERT INTO billing_checkout_requests(id,owner_id,plan_code,provider,status,external_checkout_id,checkout_url,subtotal_cents,total_cents,created_at)
    VALUES(?,?, 'pro_monthly',?,?,'checkout_test','https://asaas.test/pay',9990,9990,?)`).bind(checkoutId, owner, provider, status, createdAt).run();
  return { db, env, call, addCheckout, setAccess(value) { access = value; }, failSync(value) { failLicenseSync = value; } };
}

test('calendar billing period clamps the end of January and leap day', () => {
  assert.equal(currentPeriodEnd({ dueDate: '2026-01-31' }, 'pro_monthly'), '2026-02-28T12:00:00.000Z');
  assert.equal(currentPeriodEnd({ dueDate: '2024-02-29' }, 'pro_annual'), '2025-02-28T12:00:00.000Z');
});

test('authenticated Pro cannot create a second checkout after onboarding', async () => {
  const f = await fixture(); const original = globalThis.fetch; let creates = 0;
  globalThis.fetch = async () => { creates++; return json({ id: 'second', link: 'https://asaas.test/second' }); };
  try {
    await f.addCheckout('paid'); f.setAccess(pro);
    const response = await f.call('/api/asaas/checkout', { planCode: 'pro_monthly' }, true);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'active');
    assert.equal(creates, 0);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('activated auth account is not advertised as Pro until licensing succeeds', async () => {
  const f = await fixture();
  try {
    const nonce = 'proof'; const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(nonce))).toString('base64url');
    await f.db.prepare(`INSERT INTO billing_pending_signups(user_id,email,password_salt,password_hash,plan_code,signup_nonce_hash,status) VALUES(?,?,'salt','hash','pro_monthly',?,'activated')`).bind(owner, email, digest).run();
    await f.addCheckout('paid');
    const response = await f.call('/api/asaas/pending-status', { userId: owner, signupNonce: nonce });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'activation_pending');
  } finally { f.db.close(); }
});

test('CHECKOUT_PAID looks up Asaas data, activates the licence, and deduplicates', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_test', status: 'CONFIRMED', dueDate: '2026-09-27', subscription: 'sub_test', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => {
    if (String(url).includes('/checkouts/')) return json({ id: 'checkout_test', status: 'PAID', externalReference: `saas_checkout:${checkoutId}` });
    if (String(url).includes('/payments?')) return json({ data: [payment], hasMore: false });
    if (String(url).endsWith('/payments/pay_test')) return json(payment);
    throw new Error('Unexpected network call: ' + url);
  };
  try {
    await f.addCheckout();
    const event = { event: 'CHECKOUT_PAID', checkout: { id: 'checkout_test' } };
    const response = await f.call('/api/webhooks/asaas', event);
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'processed');
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.call('/api/webhooks/asaas', event)).status, 200);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM subscriptions").first()).n, 1);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('temporary payment mapping failure is retriable, not acknowledged as ignored', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes('/payments?') ? new Response('unavailable', { status: 503 }) : json({ id: 'pay_test', status: 'CONFIRMED', externalReference: `saas_checkout:${checkoutId}` });
  try {
    await f.addCheckout();
    const response = await f.call('/api/webhooks/asaas', { payment: { id: 'pay_test' } });
    assert.ok(response.status >= 500, `expected retry, got ${response.status}`);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('a received event abandoned by a prior worker can be processed again', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_test', status: 'CONFIRMED', dueDate: '2026-09-27', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => String(url).includes('/payments?') ? json({ data: [payment], hasMore: false }) : json(payment);
  try {
    await f.addCheckout();
    await f.db.prepare(`INSERT INTO billing_webhook_events(id,provider,external_event_id,event_type,status,payment_id,checkout_request_id,received_at) VALUES('old','asaas','payment:pay_test:CONFIRMED','PAYMENT_CONFIRMED','received','pay_test',?,'2020-01-01')`).bind(checkoutId).run();
    const response = await f.call('/api/webhooks/asaas', { payment: { id: 'pay_test' } });
    assert.equal(response.status, 200); assert.equal((await response.json()).status, 'processed');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('provider-confirmed expiry at 61 minutes permits a fresh checkout', async () => {
  const f = await fixture(); const original = globalThis.fetch; let creates = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes('/payments?')) return json({ data: [], hasMore: false });
    if (String(url).endsWith('/checkouts/checkout_test')) return json({ id: 'checkout_test', status: 'EXPIRED' });
    if (options.method === 'POST') { creates++; return json({ id: 'checkout_next', link: 'https://asaas.test/next' }); }
    throw new Error('Unexpected URL');
  };
  try {
    await f.addCheckout('checkout_created', new Date(Date.now() - 61 * 60000).toISOString());
    const response = await f.call('/api/asaas/checkout', { planCode: 'pro_monthly' }, true);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).checkoutId, 'checkout_next');
    assert.equal(creates, 1);
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'expired');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('scheduled reconciliation recovers a lost webhook without another payment', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_lost', status: 'CONFIRMED', dueDate: new Date().toISOString().slice(0,10) };
  globalThis.fetch = async () => json({ data: [payment], hasMore: false });
  try {
    await f.addCheckout();
    await reconcileBilling(f.env);
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.db.prepare('SELECT status FROM billing_webhook_events').first()).status, 'processed');
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM billing_reconciliation_schedule').first()).n, 0);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('recurring payment webhook maps directly by its verified checkoutSession', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = {
    id: 'pay_checkout_session', status: 'RECEIVED', value: 99.9, dueDate: '2026-09-28',
    subscription: 'sub_checkout_session', checkoutSession: 'checkout_test', externalReference: null,
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /\/payments\/pay_checkout_session$/);
    return json(payment);
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/webhooks/asaas', { event: 'PAYMENT_RECEIVED', payment: { id: payment.id } });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).status, 'processed');
    const subscription = await f.db.prepare('SELECT * FROM subscriptions').first();
    assert.equal(subscription.external_subscription_id, 'sub_checkout_session');
    assert.equal(subscription.status, 'active');
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('authenticated sandbox recovery verifies the payment and checkout ownership', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = {
    id: 'pay_recovery', status: 'RECEIVED', value: 99.9, dueDate: '2026-09-28',
    subscription: 'sub_recovery', checkoutSession: 'checkout_test', externalReference: null,
  };
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/api-sandbox\.asaas\.com\/v3\/payments\/pay_recovery$/);
    return json(payment);
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/asaas/reconcile-payment', { paymentId: payment.id }, true);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).status, 'processed');
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.db.prepare('SELECT external_subscription_id FROM subscriptions').first()).external_subscription_id, 'sub_recovery');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('authenticated CHECKOUT_PAID remains authoritative after Asaas stops serving the checkout', async () => {
  const f = await fixture(); const original = globalThis.fetch; const today = new Date().toISOString().slice(0,10);
  const payment = { id: 'pay_closed_checkout', status: 'CONFIRMED', value: 99.9, dueDate: today, subscription: 'sub_closed_checkout' };
  globalThis.fetch = async url => {
    const value = String(url);
    assert.doesNotMatch(value, /\/checkouts\/checkout_test$/, 'must not re-fetch a closed checkout after a verified webhook');
    if (value.includes('checkoutSession=') || value.includes('externalReference=')) return json({ data: [], hasMore: false });
    if (value.includes('/subscriptions?customer=cus_from_webhook')) return json({ data: [
      { id: 'sub_closed_checkout', cycle: 'MONTHLY', value: 99.9, dateCreated: today },
    ], hasMore: false });
    if (value.includes('subscription=sub_closed_checkout')) return json({ data: [payment], hasMore: false });
    throw new Error('Unexpected URL: ' + value);
  };
  try {
    await f.addCheckout();
    const event = { event: 'CHECKOUT_PAID', checkout: { id: 'checkout_test', status: 'PAID', customer: 'cus_from_webhook' } };
    const response = await f.call('/api/webhooks/asaas', event);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.db.prepare('SELECT external_subscription_id FROM subscriptions').first()).external_subscription_id, 'sub_closed_checkout');
    const saved = await f.db.prepare('SELECT metadata_json FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first();
    assert.equal(JSON.parse(saved.metadata_json).provider_customer_id, 'cus_from_webhook');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('monthly checkout charges on the contracting day without an unintended free day', () => {
  const priced = { totalCents: 9990, discountCents: 0, partnerCode: '', plan: { installment_max: 12 } };
  const payload = checkoutPayload('pro_monthly', checkoutId, 'https://app.test', 'sandbox', 'authenticated', priced);
  assert.equal(payload.subscription.nextDueDate.slice(0, 10), new Date().toISOString().slice(0, 10));
});

test('sandbox status reconciles only the sandbox checkout against the sandbox API', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_sandbox', status: 'CONFIRMED', dueDate: '2026-09-28', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/api-sandbox\.asaas\.com\/v3\//);
    return json({ data: [payment], hasMore: false });
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.db.prepare('SELECT provider FROM subscriptions WHERE owner_id=?').bind(owner).first()).provider, 'asaas_sandbox');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('reconciliation falls back to the exact external reference for recurring checkout payments', async () => {
  const f = await fixture(); const original = globalThis.fetch; const calls = [];
  const reference = `saas_checkout:${checkoutId}`;
  const payment = { id: 'pay_recurring', status: 'CONFIRMED', dueDate: '2026-09-28', subscription: 'sub_recurring', externalReference: reference };
  globalThis.fetch = async url => {
    calls.push(String(url));
    if (String(url).includes('checkoutSession=')) return json({ data: [], hasMore: false });
    if (String(url).includes('externalReference=')) return json({ data: [payment, { ...payment, id: 'wrong', externalReference: 'another-order' }], hasMore: false });
    throw new Error('Unexpected URL: ' + url);
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal((await f.db.prepare('SELECT external_subscription_id FROM subscriptions').first()).external_subscription_id, 'sub_recurring');
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('recurring checkout recovers through its verified customer, unique subscription and payment', async () => {
  const f = await fixture(); const original = globalThis.fetch; const calls = [];
  const payment = { id: 'pay_subscription', status: 'RECEIVED', value: 99.9, dueDate: '2026-09-28', subscription: 'sub_unique' };
  globalThis.fetch = async url => {
    const value = String(url); calls.push(value);
    if (value.includes('checkoutSession=') || value.includes('externalReference=')) return json({ data: [], hasMore: false });
    if (value.includes('/checkouts/checkout_test')) return json({ id: 'checkout_test', status: 'PAID', customer: 'cus_verified' });
    if (value.includes('/subscriptions?customer=')) return json({ data: [
      { id: 'sub_old', cycle: 'MONTHLY', value: 99.9, dateCreated: '2026-09-27' },
      { id: 'sub_unique', cycle: 'MONTHLY', value: 99.9, dateCreated: new Date().toISOString().slice(0,10) },
    ], hasMore: false });
    if (value.includes('subscription=sub_unique')) return json({ data: [payment], hasMore: false });
    throw new Error('Unexpected URL: ' + value);
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(response.status, 200, await response.clone().text());
    const subscription = await f.db.prepare('SELECT * FROM subscriptions').first();
    assert.equal(subscription.external_subscription_id, 'sub_unique');
    assert.equal(subscription.status, 'active');
    assert.equal((await f.db.prepare('SELECT status FROM billing_checkout_requests WHERE id=?').bind(checkoutId).first()).status, 'paid');
    assert.equal(calls.length, 5);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('recurring recovery refuses ambiguous same-day subscriptions', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const today = new Date().toISOString().slice(0,10);
  globalThis.fetch = async url => {
    const value = String(url);
    if (value.includes('checkoutSession=') || value.includes('externalReference=')) return json({ data: [], hasMore: false });
    if (value.includes('/checkouts/checkout_test')) return json({ id: 'checkout_test', status: 'PAID', customer: 'cus_verified' });
    if (value.includes('/subscriptions?customer=')) return json({ data: [
      { id: 'sub_one', cycle: 'MONTHLY', value: 99.9, dateCreated: today },
      { id: 'sub_two', cycle: 'MONTHLY', value: 99.9, dateCreated: today },
    ], hasMore: false });
    throw new Error('must not inspect payments for an ambiguous subscription');
  };
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    const response = await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'awaiting_payment');
    assert.equal(await f.db.prepare('SELECT * FROM subscriptions').first(), null);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('sandbox licensing sync is opt-in and identifies its sandbox source', async () => {
  const f = await fixture(); const original = globalThis.fetch; const syncs = [];
  f.env.SANDBOX_LICENSE_SYNC_ENABLED = 'true';
  f.env.ARTISYS_LICENSING.fetch = async request => {
    const body = await request.json();
    if (body.action === 'sync') syncs.push(body);
    return json(body.action === 'resolve' ? free : { ok: true });
  };
  const payment = { id: 'pay_sandbox_sync', status: 'CONFIRMED', dueDate: '2026-09-28', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async () => json({ data: [payment], hasMore: false });
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0].source, 'asaas_sandbox');
    assert.equal(syncs[0].planCode, 'pro_monthly');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('duplicate sandbox payment safely repairs a license sync enabled later', async () => {
  const f = await fixture(); const original = globalThis.fetch; const syncs = [];
  f.env.ARTISYS_LICENSING.fetch = async request => {
    const body = await request.json();
    if (body.action === 'sync') syncs.push(body);
    return json(body.action === 'resolve' ? free : { ok: true });
  };
  const payment = { id: 'pay_sandbox_retry', status: 'CONFIRMED', dueDate: '2026-09-28', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => String(url).includes('/payments?')
    ? json({ data: [payment], hasMore: false })
    : json(payment);
  try {
    await f.addCheckout('checkout_created', new Date().toISOString(), 'asaas_sandbox');
    await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(syncs.length, 0);
    await f.db.prepare('DELETE FROM billing_processing_claims').run();
    f.env.SANDBOX_LICENSE_SYNC_ENABLED = 'true';
    await f.call('/api/sandbox/asaas/status', undefined, true);
    assert.equal(syncs.length, 1);
    assert.equal(syncs[0].source, 'asaas_sandbox');
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM subscriptions').first()).n, 1);
    assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM billing_webhook_events').first()).n, 1);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('late older payment cannot revoke a newer active monthly period', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_old', status: 'REFUNDED', dueDate: '2026-08-20', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => String(url).includes('/payments?') ? json({ data: [payment] }) : json(payment);
  try {
    await f.addCheckout('paid');
    await f.db.prepare(`INSERT INTO subscriptions(id,owner_id,provider,origin_checkout_request_id,plan_code,status,current_period_end,metadata_json)
      VALUES('latest',?,'asaas',?,'pro_monthly','active','2026-10-20T12:00:00.000Z',?)`).bind(owner,checkoutId,JSON.stringify({due_date:'2026-09-20',payment_id:'pay_newer'})).run();
    const response = await f.call('/api/webhooks/asaas', { payment: { id: 'pay_old' } });
    assert.equal((await response.json()).status, 'ignored_older_period');
    const sub = await f.db.prepare('SELECT * FROM subscriptions').first();
    assert.equal(sub.status, 'active'); assert.equal(sub.current_period_end, '2026-10-20T12:00:00.000Z');
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('live owner claim prevents checkout while payment activation is in flight', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not create checkout'); };
  try {
    await f.db.prepare('INSERT INTO billing_processing_claims VALUES(?,?,?)').bind(`payment-owner:asaas:${owner}`, 'another-worker', new Date(Date.now()+60000).toISOString()).run();
    assert.equal((await f.call('/api/asaas/checkout', { planCode: 'pro_monthly' }, true)).status, 409);
  } finally { globalThis.fetch = original; f.db.close(); }
});

test('activation cannot overwrite a mailbox reservation inserted just before its transaction', async () => {
  const f = await fixture(); const original = globalThis.fetch;
  const payment = { id: 'pay_claim', status: 'CONFIRMED', dueDate: '2026-09-28', externalReference: `saas_checkout:${checkoutId}` };
  globalThis.fetch = async url => String(url).includes('/payments?') ? json({ data: [payment] }) : json(payment);
  try {
    await f.addCheckout();
    await f.db.prepare(`INSERT INTO billing_pending_signups(user_id,email,password_salt,password_hash,plan_code,signup_nonce_hash)
      VALUES(?,?,'staged-salt','staged-hash','pro_monthly','nonce')`).bind(owner,email).run();
    await f.db.prepare('DELETE FROM auth_users WHERE user_id=?').bind(owner).run();
    const batch = f.db.batch.bind(f.db);
    f.db.batch = async statements => {
      await f.db.prepare('INSERT INTO auth_users(user_id,email,password_reset_required) VALUES(?,?,1)').bind(owner,email).run();
      return batch(statements);
    };
    assert.equal((await f.call('/api/webhooks/asaas', { payment: { id: 'pay_claim' } })).status, 500);
    assert.equal((await f.db.prepare('SELECT password_reset_required n FROM auth_users WHERE user_id=?').bind(owner).first()).n, 1);
    assert.equal(await f.db.prepare('SELECT * FROM auth_credentials WHERE user_id=?').bind(owner).first(), null);
    assert.equal((await f.db.prepare('SELECT status FROM billing_pending_signups').first()).status, 'paid');
  } finally { globalThis.fetch = original; f.db.close(); }
});
