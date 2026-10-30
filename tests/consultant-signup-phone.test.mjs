import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSqliteD1 } from './helpers/sqlite-d1.mjs';
import { normalizeConsultantSignupPhone } from '../worker/signup-phone.js';
import { handleCloudflareAuthRuntime } from '../worker/cloudflare-auth-runtime.js';
import { handleCloudflareBillingRuntime } from '../worker/cloudflare-billing-runtime.js';

const post = (path, body) => new Request('https://app.test' + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const envFor = db => ({ CLINICAL_DB: db, CLINICAL_AUTH_SECRET: 'local-unit-secret',
  ARTISYS_LICENSING: { fetch: async () => Response.json({ productCode: 'debora-lactacao', commercial: true, active: true, status: 'active', planCode: 'pro_monthly' }) },
});

test('signup UI requests optional cellphone and sends it in both signup paths', () => {
  const html = readFileSync(new URL('../public/comercial/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../public/comercial/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="signup-form"[\s\S]*name="phone"[\s\S]*name="password"/);
  assert.match(js, /body: JSON.stringify\(\{ email, password, phone, planCode: selectedPlan/);
  assert.match(js, /email,\s*password,\s*phone,\s*data:/);
  assert.match(js, /phoneInput.value = user.phone \|\| ''/);
});

test('optional phone is normalized, absent phone is supported, malformed phone rejected', () => {
  assert.equal(normalizeConsultantSignupPhone(null), null);
  assert.equal(normalizeConsultantSignupPhone(''), null);
  assert.equal(normalizeConsultantSignupPhone('+55 (16) 99999-9999'), '(16) 99999-9999');
  assert.equal(normalizeConsultantSignupPhone('(16) 3333-4444'), '(16) 3333-4444');
  assert.throws(() => normalizeConsultantSignupPhone('abc'), /invalid_signup_phone/);
  assert.throws(() => normalizeConsultantSignupPhone('123'), /invalid_signup_phone/);
});

test('free consultant signup persists phone but legacy password logins continue without it', async () => {
  const db = createSqliteD1(); const env = envFor(db);
  try {
    const signup = await handleCloudflareAuthRuntime(post('/api/auth/signup', {
      email: 'free-phone@example.test', password: 'valid-free-password', phone: '16 99999-0000', data: { signup_source: 'commercial_saas' },
    }), env);
    assert.equal(signup.status, 200, await signup.clone().text());
    const created = await signup.json();
    assert.equal(created.user.phone, '(16) 99999-0000');
    const stored = await db.prepare('SELECT phone FROM auth_users WHERE email=?').bind('free-phone@example.test').first();
    assert.equal(stored.phone, '(16) 99999-0000');
    const old = await handleCloudflareAuthRuntime(post('/api/auth/signup', {
      email: 'legacy-no-phone@example.test', password: 'valid-free-password', data: { signup_source: 'commercial_saas' },
    }), env);
    assert.equal(old.status, 200, await old.clone().text());
    const login = await handleCloudflareAuthRuntime(post('/api/auth/token?grant_type=password', {
      email: 'legacy-no-phone@example.test', password: 'valid-free-password',
    }), env);
    assert.equal(login.status, 200, await login.clone().text());
    assert.equal((await login.json()).user.phone, null);
  } finally { db.close(); }
});

test('pending Pro signup preserves phone without provisioning a user before payment', async () => {
  const db = createSqliteD1(); const env = envFor(db);
  try {
    const payload = { email: 'pro-phone@example.test', password: 'valid-pro-password', planCode: 'pro_monthly', phone: '(16) 98888-7777' };
    const response = await handleCloudflareBillingRuntime(post('/api/asaas/signup', payload), env);
    assert.equal(response.status, 200, await response.clone().text());
    const proof = await response.json();
    assert.equal(await db.prepare('SELECT user_id FROM auth_users WHERE user_id=?').bind(proof.userId).first(), null);
    assert.equal((await db.prepare('SELECT phone FROM billing_signup_contacts WHERE user_id=?').bind(proof.userId).first()).phone, '(16) 98888-7777');
    const retry = await handleCloudflareBillingRuntime(post('/api/asaas/signup', { ...payload, phone: '' }), env);
    assert.equal(retry.status, 200, await retry.clone().text());
    assert.equal((await retry.json()).userId, proof.userId);
    assert.equal((await db.prepare('SELECT phone FROM billing_signup_contacts WHERE user_id=?').bind(proof.userId).first()).phone, '(16) 98888-7777');
    const wrong = await handleCloudflareBillingRuntime(post('/api/asaas/signup', { ...payload, phone: 'abc' }), env);
    assert.equal(wrong.status, 400);
  } finally { db.close(); }
});
