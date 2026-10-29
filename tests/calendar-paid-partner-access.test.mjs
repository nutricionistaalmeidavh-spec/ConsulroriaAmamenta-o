import test from 'node:test';
import assert from 'node:assert/strict';
import { canUseExternalCalendar } from '../worker/calendar-access-policy.js';
import { createLocalRuntime, userId } from './helpers/cloudflare-local.mjs';

const origin = 'https://deboralactacao.com';
const pro = (overrides = {}) => ({
  productCode: 'debora-lactacao', planCode: 'pro_monthly',
  active: true, commercial: true, enforceLimits: true,
  patientLimit: null, mediaUpload: true, status: 'active',
  expiresAt: '2030-01-01T00:00:00.000Z', calendarAccess: true, ...overrides,
});
const free = {
  productCode: 'debora-lactacao', planCode: 'freemium',
  active: false, commercial: true, enforceLimits: true,
  patientLimit: 3, mediaUpload: false, status: 'freemium',
};
const legacy = {
  productCode: 'debora-lactacao', planCode: 'legacy_unmanaged',
  active: true, commercial: false, enforceLimits: false,
  patientLimit: null, mediaUpload: true, status: 'unmanaged',
};

const licensing = current => async () => Response.json(current.value);

test('only verified active Pro or explicit partner can use external calendar', async () => {
  const current = { value: pro() };
  const { db, close } = await createLocalRuntime({ licensing: licensing(current) });
  try {
    const user = { id: userId, email: 'audit@example.test' };
    const env = {
      CLINICAL_DB: db,
      LICENSE_SERVICE_SECRET: 'test',
      ARTISYS_LICENSING: { fetch: licensing(current) },
    };
    assert.equal(await canUseExternalCalendar(env, user), true);
    current.value = pro({ calendarAccess:false });
    assert.equal(await canUseExternalCalendar(env,user),false,'central entitlement must be authoritative');
    current.value = pro();
    for (const access of [free, legacy, pro({status:'trialing'}), pro({expiresAt:'2020-01-01T00:00:00.000Z'})]) {
      current.value = access;
      if (access.expiresAt === '2020-01-01T00:00:00.000Z') {
        await assert.rejects(() => canUseExternalCalendar(env,user), /licensing_unavailable/);
      } else {
        assert.equal(await canUseExternalCalendar(env,user), false, access.planCode);
      }
    }
    current.value = free;
    // No separate email list, editable profile role, or referral coupon is trusted.
    assert.equal(await canUseExternalCalendar({...env,CALENDAR_PARTNER_EMAILS:'audit@example.test'},user),false);
    assert.equal(await canUseExternalCalendar(env,{...user,app_metadata:{calendar_partner:true}}),false);
    assert.equal(await canUseExternalCalendar(env,{...user,user_metadata:{calendar_partner:true}}),false);
    assert.equal(await canUseExternalCalendar(env,{...user,app_metadata:{partner_admin:true}}),false);
    assert.equal(await canUseExternalCalendar(env,{...user,partner_code:'COUPON'}),false);
  } finally { await close(); }
});

test('Apple and Outlook reject unpaid accounts, permit Pro/partner, and stop existing ICS feeds when access ends', async () => {
  const current = {value: free};
  const runtime = await createLocalRuntime({licensing: licensing(current), bindings:{CALENDAR_PARTNER_EMAILS:''}});
  const {mf,db,login,close} = runtime;
  const api = (url,options={})=>mf.dispatchFetch(origin+url,options);
  const path = provider => '/api/calendar/'+provider;
  try {
    const user = await login();
    const headers = {authorization:'Bearer '+user.access_token};
    for(const provider of ['apple','outlook']) {
      assert.equal((await api(path(provider)+'/status',{headers})).status,403);
      assert.equal((await api(path(provider)+'/create',{method:'POST',headers})).status,403);
    }
    current.value = pro({calendarAccess:true});
    const urls = [];
    for(const provider of ['apple','outlook']) {
      const create = await api(path(provider)+'/create',{method:'POST',headers});
      assert.equal(create.status,200,provider);
      const payload=await create.json();
      urls.push(new URL(payload.subscription_url).pathname);
      assert.equal((await api(urls.at(-1))).status,200);
    }
    current.value = free;
    for(const url of urls) {
      assert.equal((await api(url)).status,404,'feed must stop when Pro expires');
      assert.equal((await api(url,{method:'HEAD'})).status,404,'HEAD must not bypass access');
    }
    for(const provider of ['apple','outlook']) {
      assert.equal((await api(path(provider)+'/status',{headers})).status,403);
    }
    // A manual partnership classified by the Central shares the same
    // authoritative, verified entitlement as a paid subscription.
    current.value = pro({planCode:'pro_6m',source:'mercado_livre_manual',calendarAccess:true});
    for(const provider of ['apple','outlook']) {
      assert.equal((await api(path(provider)+'/status',{headers})).status,200,'partner access');
    }
    for(const url of urls) assert.equal((await api(url)).status,200,'partner ICS access');
    // Google stays a closed pilot even for an explicitly authorized partner.
    assert.equal((await api('/api/calendar/google/status',{headers})).status,403);
  } finally { await close(); }
});
