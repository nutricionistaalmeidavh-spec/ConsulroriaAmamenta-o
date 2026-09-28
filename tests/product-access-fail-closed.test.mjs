import test from 'node:test';
import assert from 'node:assert/strict';
import { persistNewPatient } from '../worker/patient-write-runtime.js';
import { resolveProductAccess } from '../worker/product-access-runtime.js';
import { handleCloudflareDataRuntime } from '../worker/cloudflare-data-runtime.js';
import { createHmac } from 'node:crypto';

const legacy = { productCode: 'debora-lactacao', planCode: 'legacy_unmanaged', active: true, commercial: false, enforceLimits: false, patientLimit: null, mediaUpload: true, status: 'unmanaged' };
const free = { ...legacy, planCode: 'freemium', active: false, commercial: true, enforceLimits: true, patientLimit: 3, mediaUpload: false, status: 'freemium' };
const user = { id: 'new-user', email: 'test@example.com', app_metadata: {} };
function fixture(response, marker = false) {
  const calls = [];
  const db = { writes: 0, prepare(sql) { return { bind() { return this; }, async first() { return sql.includes('COUNT') ? { n: 3 } : marker ? { found: 1 } : null; } }; }, async batch() { this.writes++; } };
  const env = { CLINICAL_DB: db, LICENSE_SERVICE_SECRET: 'test', ARTISYS_LICENSING: { async fetch(request) { const body = await request.json(); calls.push(body.action); return typeof response === 'function' ? response(body, calls) : response.clone(); } } };
  return { env, db, calls };
}
const input = { mother: { name: 'Mother' }, babies: [{ name: 'Baby' }] };
for (const [name, response] of [['HTTP failure', new Response('{}', { status: 503 })], ['invalid JSON', new Response('invalid')], ['null', Response.json(null)], ['unknown shape', Response.json({ commercial: false })]]) {
  test(`patient creation fails closed on ${name}`, async () => {
    const { env, db } = fixture(response);
    await assert.rejects(persistNewPatient(env, user, input), error => error.status === 503 && error.code === 'licensing_unavailable');
    assert.equal(db.writes, 0);
  });
}
test('patient creation fails closed when binding is missing', async () => {
  const { env, db } = fixture(Response.json(legacy));
  delete env.ARTISYS_LICENSING;
  await assert.rejects(persistNewPatient(env, user, input), error => error.status === 503);
  assert.equal(db.writes, 0);
});
test('confirmed legacy access remains compatible', async () => {
  const { env, db } = fixture(Response.json(legacy));
  await persistNewPatient(env, user, input);
  assert.equal(db.writes, 1);
});
test('trusted new account is registered before limits, without frontend bootstrap', async () => {
  const { env, db, calls } = fixture((body, calls) => Response.json(body.action === 'register' ? { commercial: true } : calls.length === 1 ? legacy : free));
  await assert.rejects(persistNewPatient(env, { ...user, app_metadata: { commercial_account: true } }, input), error => error.status === 403);
  assert.deepEqual(calls, ['resolve', 'register', 'resolve']);
  assert.equal(db.writes, 0);
});
test('user-controlled metadata does not classify a legacy account', async () => {
  const { env, calls } = fixture(Response.json(legacy));
  await persistNewPatient(env, { ...user, user_metadata: { commercial_account: true } }, input);
  assert.deepEqual(calls, ['resolve']);
});
test('existing commercial D1 marker also registers without frontend bootstrap', async () => {
  const { env, calls } = fixture((body, calls) => Response.json(body.action === 'register' ? { commercial: true } : calls.length === 1 ? legacy : free), true);
  assert.deepEqual(await resolveProductAccess(env, user), free);
  assert.deepEqual(calls, ['resolve', 'register', 'resolve']);
});
test('registration that does not establish commercial access fails closed', async () => {
  const { env } = fixture(Response.json(legacy), true);
  await assert.rejects(resolveProductAccess(env, user), error => error.status === 503);
});
test('missing secret and network exception fail closed', async () => {
  const { env } = fixture(Response.json(legacy));
  delete env.LICENSE_SERVICE_SECRET;
  await assert.rejects(resolveProductAccess(env, user), error => error.status === 503);
  env.LICENSE_SERVICE_SECRET = 'test';
  env.ARTISYS_LICENSING.fetch = async () => { throw new Error('network'); };
  await assert.rejects(resolveProductAccess(env, user), error => error.status === 503);
});
test('active Pro is permitted and expired Pro is never trusted', async () => {
  const pro = { ...free, planCode: 'pro_monthly', active: true, patientLimit: null, mediaUpload: true, status: 'active' };
  const { env } = fixture(Response.json(pro));
  assert.deepEqual(await resolveProductAccess(env, user), pro);
  env.ARTISYS_LICENSING.fetch = async () => Response.json({ ...pro, expiresAt: '2000-01-01T00:00:00Z' });
  await assert.rejects(resolveProductAccess(env, user), error => error.status === 503);
});

function authenticatedFixture(access) {
  let writes = 0;
  const env = {
    CLINICAL_AUTH_SECRET: 'test-auth', LICENSE_SERVICE_SECRET: 'test',
    ARTISYS_LICENSING: { fetch: async () => Response.json(access) },
    CLINICAL_FILES: { put: async () => { writes++; return {}; } },
    CLINICAL_DB: { prepare(sql) { return { bind() { return this; }, async first() { return sql.includes('auth_users') ? { user_id: user.id, email: user.email, app_metadata_json: '{}' } : null; }, async run() { return {}; } }; } },
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ typ: 'access', sub: user.id, exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
  const signed = `${header}.${payload}`;
  const signature = createHmac('sha256', env.CLINICAL_AUTH_SECRET).update(signed).digest('base64url');
  return { env, headers: { authorization: `Bearer ${signed}.${signature}`, 'content-type': 'image/png' }, writes: () => writes };
}
for (const [name, access, expected] of [['invalid', null, 503], ['Freemium', free, 403], ['legacy', legacy, 200]]) {
  test(`media route enforces ${name} access`, async () => {
    const { env, headers, writes } = authenticatedFixture(access);
    const request = new Request(`https://app.test/api/files/object/clinical-media/${user.id}/photo.png`, { method: 'POST', headers, body: 'image' });
    const response = await handleCloudflareDataRuntime(request, env);
    assert.equal(response.status, expected);
    assert.equal(writes(), expected === 200 ? 1 : 0);
  });
}
test('license status API returns 503 for unknown access', async () => {
  const { env, headers } = authenticatedFixture({});
  const response = await handleCloudflareDataRuntime(new Request('https://app.test/api/license/me', { headers }), env);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'licensing_unavailable');
});
