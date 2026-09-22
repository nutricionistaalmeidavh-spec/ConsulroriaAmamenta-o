import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_EMAIL } from '../scripts/demo-account-fixture.mjs';
import { DEFAULT_LICENSE_ENDPOINT, syncDemoProLicense } from '../scripts/demo-account-license.mjs';

test('syncDemoProLicense refuses to run without the central license secret', async () => {
  let called = false;
  await assert.rejects(
    () => syncDemoProLicense({ secret: '', fetchImpl: async () => { called = true; } }),
    /demo_license_secret_missing/
  );
  assert.equal(called, false);
});

test('syncDemoProLicense sends a real pro_6m sync through the existing internal authority', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: 'license-1', email: DEMO_EMAIL, plan_code: 'pro_6m', status: 'active' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const result = await syncDemoProLicense({
    secret: 'super-secret-value',
    now: new Date('2026-09-22T13:00:00.000Z'),
    fetchImpl,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, DEFAULT_LICENSE_ENDPOINT);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['x-artisys-license-secret'], 'super-secret-value');
  assert.deepEqual(calls[0].body, {
    action: 'sync',
    productCode: 'debora-lactacao',
    email: DEMO_EMAIL,
    planCode: 'pro_6m',
    status: 'active',
    expiresAt: '2027-03-22T13:00:00.000Z',
    source: 'demo_seed',
    externalRef: 'demo-account',
    actor: 'demo-provisioner',
  });
  assert.equal(result.status, 'active');
});

test('syncDemoProLicense surfaces central authority failures without leaking the secret', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type': 'application/json' } });
  await assert.rejects(
    () => syncDemoProLicense({ secret: 'do-not-leak-me', fetchImpl }),
    (error) => {
      assert.match(error.message, /demo_license_sync_failed:unauthorized/);
      assert.doesNotMatch(error.message, /do-not-leak-me/);
      return true;
    }
  );
});
