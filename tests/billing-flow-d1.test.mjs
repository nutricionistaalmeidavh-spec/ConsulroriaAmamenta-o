import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from './helpers/cloudflare-local.mjs';

const baseAccess = { productCode: 'debora-lactacao', enforceLimits: true, commercial: true };
const free = { ...baseAccess, planCode: 'freemium', active: false, patientLimit: 3, mediaUpload: false, status: 'freemium' };

for (const planCode of ['pro_monthly', 'pro_annual']) {
  test(`real Worker/D1: new ${planCode}, payment, failed sync, retry, access and no second checkout`, async () => {
    let creates = 0; let reference; let paid = false; let failSync = true; let access = { ...free };
    const payment = () => ({ id: 'pay_new', status: 'CONFIRMED', customer: 'customer_test',
      dueDate: new Date().toISOString().slice(0, 10), externalReference: reference,
      ...(planCode === 'pro_monthly' ? { subscription: 'sub_new' } : {}),
    });
    const runtime = await createLocalRuntime({ bindings: { ASAAS_SECRET: 'local-test-provider' },
      licensing: async request => {
        const body = await request.json();
        if (body.action === 'sync') {
          if (failSync) return Response.json({ error: 'injected_sync_failure' }, { status: 503 });
          access = { ...baseAccess, active: body.status === 'active', planCode: body.planCode, patientLimit: null, mediaUpload: true, status: 'active', expiresAt: body.expiresAt };
        }
        return Response.json(body.action === 'resolve' ? access : { ok: true });
      },
      outboundService: async request => {
        const url = new URL(request.url);
        assert.equal(url.hostname, 'api.asaas.com');
        if (url.pathname === '/v3/checkouts' && request.method === 'POST') {
          creates++; const body = await request.json(); reference = body.externalReference;
          assert.equal(body.items[0].value, planCode === 'pro_monthly' ? 99.9 : 999.9);
          return Response.json({ id: 'checkout_new', link: 'https://asaas.test/checkout_new' });
        }
        if (url.pathname === '/v3/checkouts/checkout_new') return Response.json({ id: 'checkout_new', status: paid ? 'PAID' : 'ACTIVE', externalReference: reference });
        if (url.pathname === '/v3/payments') return Response.json({ data: paid ? [payment()] : [], hasMore: false });
        if (url.pathname === '/v3/payments/pay_new') return Response.json(payment());
        throw new Error('Unexpected provider call ' + request.url);
      },
    });
    const call = (path, data, token) => runtime.mf.dispatchFetch('https://app.test' + path, {
      method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    try {
      const email = `${planCode}@example.test`, password = 'New-client-only-2026!';
      const signup = await call('/api/billing/signup', { email, password, planCode });
      assert.equal(signup.status, 200, await signup.clone().text());
      const proof = await signup.json();
      assert.equal(await runtime.db.prepare('SELECT user_id FROM auth_users WHERE email=?').bind(email).first(), null);
      const checkout = await call('/api/billing/preauth-checkout', { ...proof, planCode });
      assert.equal(checkout.status, 200, await checkout.clone().text());
      assert.equal((await checkout.json()).status, 'checkout_created');
      assert.equal(creates, 1);
      paid = true;
      const webhook = { event: 'CHECKOUT_PAID', checkout: { id: 'checkout_new' } };
      const failed = await call('/api/billing/webhooks/asaas', webhook);
      assert.ok(failed.status >= 500);
      const pending = await call('/api/billing/pending-status', proof);
      assert.equal((await pending.json()).status, 'activation_pending');
      failSync = false;
      const retry = await call('/api/billing/webhooks/asaas', webhook);
      assert.equal(retry.status, 200, await retry.clone().text());
      assert.equal((await (await call('/api/billing/pending-status', proof)).json()).status, 'account_activated');
      const login = await call('/api/auth/token?grant_type=password', { email, password });
      assert.equal(login.status, 200, await login.clone().text());
      const token = (await login.json()).access_token;
      const status = await call('/api/billing/status', undefined, token);
      assert.equal((await status.json()).status, 'active');
      const attempts = await Promise.all([1, 2].map(() => call('/api/billing/checkout', { planCode }, token)));
      assert.ok(attempts.every(response => [200, 409].includes(response.status)));
      for (const response of attempts) if (response.status === 200) assert.equal((await response.json()).status, 'active');
      assert.equal(creates, 1);
      assert.equal((await runtime.db.prepare('SELECT COUNT(*) n FROM billing_checkout_requests').first()).n, 1);
      assert.equal((await runtime.db.prepare('SELECT status FROM billing_webhook_events').first()).status, 'processed');
      assert.equal((await call('/api/billing/status')).status, 401);
    } finally { await runtime.close(); }
  });
}
