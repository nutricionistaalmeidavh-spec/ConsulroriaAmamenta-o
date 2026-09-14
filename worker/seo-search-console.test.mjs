import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSeoGoogleOverview, handleSeoPasswordLogin } from './seo-search-console.js';

function baseEnv(overrides = {}) {
  return {
    ARTISYS_SEO_ADMIN_TOKEN: 'seo-admin-secret-used-as-signing-key',
    ARTISYS_SEO_ADMIN_PASSWORD: 'DyDwv4-6YClt-J6V-uLd',
    ARTISYS_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    ARTISYS_GOOGLE_CLIENT_SECRET: 'client-secret',
    ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: 'refresh-secret',
    ARTISYS_SEO_SITE_URL: 'deboralactacao.com',
    ...overrides,
  };
}

function request(token = 'seo-admin-secret-used-as-signing-key', cookie = '') {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  return new Request('https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31', { headers });
}

async function body(response) { return response.json(); }

function searchConsoleFetch(calls = []) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    }
    const payload = JSON.parse(options.body || '{}');
    if (Array.isArray(payload.dimensions) && payload.dimensions.length === 0) {
      return new Response(JSON.stringify({ rows: [{ clicks: 12, impressions: 300, ctr: 0.04, position: 6.5 }] }), { status: 200 });
    }
    if (payload.dimensions?.[0] === 'query') {
      return new Response(JSON.stringify({ rows: [{ keys: ['consultoria amamentação'], clicks: 8, impressions: 100, ctr: 0.08, position: 3.1 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ rows: [{ keys: ['https://deboralactacao.com/'], clicks: 10, impressions: 220, ctr: 10 / 220, position: 5.2 }] }), { status: 200 });
  };
}

test('SEO overview requires an administrative credential or signed SEO session', async () => {
  const response = await handleSeoGoogleOverview(request(null), baseEnv(), { fetch: async () => { throw new Error('must not run'); } });
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'unauthorized' });
});

test('password login creates an HttpOnly SEO session for the owner', async () => {
  const loginRequest = new Request('https://deboralactacao.com/api/seo/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nutricionistaalmeidavh@gmail.com', password: 'DyDwv4-6YClt-J6V-uLd' }),
  });
  const loginResponse = await handleSeoPasswordLogin(loginRequest, baseEnv(), { now: () => Date.parse('2026-09-13T20:00:00Z') });
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await body(loginResponse), { ok: true, email: 'nutricionistaalmeidavh@gmail.com' });
  const setCookie = loginResponse.headers.get('set-cookie') || '';
  assert.match(setCookie, /^artisys-seo-session=/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);

  const cookie = setCookie.split(';')[0];
  const response = await handleSeoGoogleOverview(request(null, cookie), baseEnv(), {
    fetch: searchConsoleFetch([]), now: () => Date.parse('2026-09-13T20:01:00Z'),
  });
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
});

test('password login rejects wrong password without creating a session', async () => {
  const response = await handleSeoPasswordLogin(new Request('https://deboralactacao.com/api/seo/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nutricionistaalmeidavh@gmail.com', password: 'errada' }),
  }), baseEnv());
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'invalid_credentials' });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('password login rejects any other email', async () => {
  const response = await handleSeoPasswordLogin(new Request('https://deboralactacao.com/api/seo/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'outro@gmail.com', password: 'DyDwv4-6YClt-J6V-uLd' }),
  }), baseEnv());
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'invalid_credentials' });
});

test('password login reports missing password secret', async () => {
  const response = await handleSeoPasswordLogin(new Request('https://deboralactacao.com/api/seo/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nutricionistaalmeidavh@gmail.com', password: 'qualquer' }),
  }), baseEnv({ ARTISYS_SEO_ADMIN_PASSWORD: '' }));
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_password_not_configured' });
});

test('legacy SEO admin token remains an emergency fallback', async () => {
  const response = await handleSeoGoogleOverview(request(), baseEnv(), { fetch: searchConsoleFetch([]) });
  assert.equal(response.status, 200);
  assert.equal((await body(response)).ok, true);
});

test('SEO overview derives actionable audit opportunities from Search Console rows', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), { status: 200 });
    const payload = JSON.parse(options.body || '{}');
    if (Array.isArray(payload.dimensions) && payload.dimensions.length === 0) return new Response(JSON.stringify({ rows: [{ clicks: 20, impressions: 1000, ctr: 0.02, position: 9.1 }] }), { status: 200 });
    if (payload.dimensions?.[0] === 'query') return new Response(JSON.stringify({ rows: [{ keys: ['dor ao amamentar'], clicks: 2, impressions: 220, ctr: 0.009, position: 8.4 }] }), { status: 200 });
    return new Response(JSON.stringify({ rows: [{ keys: ['https://deboralactacao.com/'], clicks: 18, impressions: 900, ctr: 0.02, position: 8.9 }] }), { status: 200 });
  };
  const response = await handleSeoGoogleOverview(request(), baseEnv(), { fetch: fetchImpl });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.ok(result.audit.opportunities.some((item) => item.type === 'low_ctr_query'));
});

test('SEO overview reports missing Google Search Console configuration without exposing details', async () => {
  const response = await handleSeoGoogleOverview(request(), baseEnv({ ARTISYS_GOOGLE_CLIENT_SECRET: '' }), { fetch: async () => { throw new Error('must not run'); } });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_google_not_configured' });
});
