import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const futurePeriodEnd = '2099-10-30T12:00:00.000Z';

test('monthly cancellation deletes provider recurrence once and preserves paid access', async () => {
  let deleteCalls = 0;
  const access = {
    productCode: 'debora-lactacao',
    planCode: 'pro_monthly',
    active: true,
    commercial: true,
    enforceLimits: true,
    patientLimit: null,
    mediaUpload: true,
    status: 'active',
    expiresAt: futurePeriodEnd,
  };

  const runtime = await createLocalRuntime({
    bindings: { ASAAS_SECRET: 'local-test-provider' },
    licensing: async request => {
      const body = await request.json();
      if (body.action === 'resolve') return Response.json(access);
      return Response.json({ ok: true });
    },
    outboundService: async request => {
      const url = new URL(request.url);
      assert.equal(url.hostname, 'api.asaas.com');
      if (url.pathname === '/v3/subscriptions/sub_cancel' && request.method === 'DELETE') {
        deleteCalls += 1;
        return Response.json({ deleted: true });
      }
      if (url.pathname === '/v3/subscriptions' && request.method === 'GET') {
        assert.equal(url.searchParams.get('customer'), 'customer_cancel');
        assert.equal(url.searchParams.get('deletedOnly'), 'true');
        return Response.json({ data: [{ id: 'sub_cancel' }], hasMore: false });
      }
      throw new Error(`Unexpected provider call ${request.method} ${request.url}`);
    },
  });

  const call = async (path, token, options = {}) => runtime.mf.dispatchFetch(`https://app.test${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  try {
    await runtime.db.prepare(`INSERT INTO subscriptions(
      id,owner_id,provider,external_customer_id,external_subscription_id,plan_code,status,current_period_end,metadata_json
    ) VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      'subscription-row-cancel', userId, 'asaas', 'customer_cancel', 'sub_cancel',
      'pro_monthly', 'active', futurePeriodEnd, JSON.stringify({ payment_id: 'pay_initial', backend: 'cloudflare-d1' }),
    ).run();

    const token = (await runtime.login()).access_token;

    const beforeResponse = await call('/api/billing/subscription', token);
    assert.equal(beforeResponse.status, 200, await beforeResponse.clone().text());
    const before = await beforeResponse.json();
    assert.equal(before.planCode, 'pro_monthly');
    assert.equal(before.autoRenew, true);
    assert.equal(before.canCancel, true);
    assert.equal(before.cancelAtPeriodEnd, false);

    const cancelledResponse = await call('/api/billing/subscription/cancel', token, { method: 'POST' });
    assert.equal(cancelledResponse.status, 200, await cancelledResponse.clone().text());
    const cancelled = await cancelledResponse.json();
    assert.equal(cancelled.autoRenew, false);
    assert.equal(cancelled.canCancel, false);
    assert.equal(cancelled.cancelAtPeriodEnd, true);
    assert.equal(cancelled.accessUntil, futurePeriodEnd);
    assert.equal(deleteCalls, 1);

    const persisted = await runtime.db.prepare('SELECT status,current_period_end,metadata_json FROM subscriptions WHERE id=?')
      .bind('subscription-row-cancel').first();
    assert.equal(persisted.status, 'active');
    assert.equal(persisted.current_period_end, futurePeriodEnd);
    const metadata = JSON.parse(persisted.metadata_json);
    assert.equal(metadata.cancel_at_period_end, true);
    assert.equal(metadata.cancellation_source, 'self_service');
    assert.ok(metadata.cancellation_requested_at);
    assert.ok(metadata.provider_deleted_at);

    const againResponse = await call('/api/billing/subscription/cancel', token, { method: 'POST' });
    assert.equal(againResponse.status, 200, await againResponse.clone().text());
    assert.equal((await againResponse.json()).cancelAtPeriodEnd, true);
    assert.equal(deleteCalls, 1, 'idempotent retry must not delete provider recurrence twice');

    const paymentDeleted = await call('/api/billing/webhooks/asaas', null, {
      method: 'POST',
      body: { event: 'PAYMENT_DELETED', payment: { id: 'pay_future_deleted', subscription: 'sub_cancel' } },
    });
    assert.equal(paymentDeleted.status, 200, await paymentDeleted.clone().text());
    assert.equal((await paymentDeleted.json()).status, 'ignored_cancelled_recurring_payment');
    assert.equal((await runtime.db.prepare('SELECT status FROM subscriptions WHERE id=?').bind('subscription-row-cancel').first()).status, 'active');

    const subscriptionDeleted = await call('/api/billing/webhooks/asaas', null, {
      method: 'POST',
      body: { id: 'evt_subscription_deleted_1', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_cancel' } },
    });
    assert.equal(subscriptionDeleted.status, 200, await subscriptionDeleted.clone().text());
    assert.equal((await subscriptionDeleted.json()).status, 'processed');
    assert.equal((await runtime.db.prepare('SELECT status FROM subscriptions WHERE id=?').bind('subscription-row-cancel').first()).status, 'active');

    const after = await (await call('/api/billing/subscription', token)).json();
    assert.equal(after.cancelAtPeriodEnd, true);
    assert.equal(after.autoRenew, false);
    assert.equal(after.accessUntil, futurePeriodEnd);

    assert.equal((await call('/api/billing/subscription')).status, 401);
    assert.equal((await call('/api/billing/subscription/cancel', null, { method: 'POST' })).status, 401);
  } finally {
    await runtime.close();
  }
});

test('non-recurring annual plan cannot call monthly renewal cancellation', async () => {
  let deleteCalls = 0;
  const runtime = await createLocalRuntime({
    bindings: { ASAAS_SECRET: 'local-test-provider' },
    licensing: async () => Response.json({
      productCode: 'debora-lactacao', planCode: 'pro_annual', active: true, commercial: true,
      enforceLimits: true, patientLimit: null, mediaUpload: true, status: 'active', expiresAt: futurePeriodEnd,
    }),
    outboundService: async request => {
      deleteCalls += 1;
      throw new Error(`Provider must not be called for annual cancellation: ${request.url}`);
    },
  });

  try {
    await runtime.db.prepare(`INSERT INTO subscriptions(
      id,owner_id,provider,external_customer_id,external_subscription_id,plan_code,status,current_period_end,metadata_json
    ) VALUES(?,?,?,?,?,?,?,?,?)`).bind(
      'subscription-row-annual', userId, 'asaas', 'customer_annual', null,
      'pro_annual', 'active', futurePeriodEnd, '{}',
    ).run();
    const token = (await runtime.login()).access_token;
    const response = await runtime.mf.dispatchFetch('https://app.test/api/billing/subscription/cancel', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 409, await response.clone().text());
    assert.equal((await response.json()).error, 'subscription_not_recurring');
    assert.equal(deleteCalls, 0);
  } finally {
    await runtime.close();
  }
});
