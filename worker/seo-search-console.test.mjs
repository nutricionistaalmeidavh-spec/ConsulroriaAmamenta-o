import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSeoGoogleOverview, handleSeoGoogleSession } from './seo-search-console.js';

function baseEnv(overrides = {}) {
  return {
    ARTISYS_SEO_ADMIN_TOKEN: 'seo-admin-secret-used-as-signing-key',
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

async function body(response) {
  return response.json();
}

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
  let calls = 0;
  const response = await handleSeoGoogleOverview(request(null), baseEnv(), {
    fetch: async () => { calls += 1; throw new Error('must not run'); },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'unauthorized' });
  assert.equal(calls, 0);
});

test('legacy SEO admin token remains an emergency fallback', async () => {
  const calls = [];
  const response = await handleSeoGoogleOverview(request(), baseEnv(), {
    fetch: searchConsoleFetch(calls),
  });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
});

test('existing ArtiSys Google SSO code creates an HttpOnly SEO session for the owner', async () => {
  const brokerCalls = [];
  const sessionRequest = new Request('https://deboralactacao.com/api/seo/google/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'a'.repeat(64) }),
  });
  const sessionResponse = await handleSeoGoogleSession(sessionRequest, baseEnv(), {
    fetch: async (url, options = {}) => {
      brokerCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true, email: 'nutricionistaalmeidavh@gmail.com', target: 'debora-seo' }), { status: 200 });
    },
    now: () => Date.parse('2026-09-13T20:00:00Z'),
  });

  assert.equal(sessionResponse.status, 200);
  assert.deepEqual(await body(sessionResponse), { ok: true, email: 'nutricionistaalmeidavh@gmail.com' });
  const setCookie = sessionResponse.headers.get('set-cookie') || '';
  assert.match(setCookie, /^artisys-seo-session=/i);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.equal(brokerCalls.length, 1);
  assert.match(brokerCalls[0].url, /api\/artisys-sso\/redeem$/);

  const cookie = setCookie.split(';')[0];
  const calls = [];
  const response = await handleSeoGoogleOverview(request(null, cookie), baseEnv(), {
    fetch: searchConsoleFetch(calls),
    now: () => Date.parse('2026-09-13T20:01:00Z'),
  });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.googleSearch.metrics.clicks, 12);
});

test('SSO exchange refuses any identity other than the owner email', async () => {
  const sessionRequest = new Request('https://deboralactacao.com/api/seo/google/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'b'.repeat(64) }),
  });
  const response = await handleSeoGoogleSession(sessionRequest, baseEnv(), {
    fetch: async () => new Response(JSON.stringify({ ok: true, email: 'outro@gmail.com', target: 'debora-seo' }), { status: 200 }),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'forbidden' });
  assert.equal(response.headers.get('set-cookie'), null);
});

test('SEO overview derives actionable audit opportunities from Search Console rows', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600 }), { status: 200 });
    }
    const payload = JSON.parse(options.body || '{}');
    if (Array.isArray(payload.dimensions) && payload.dimensions.length === 0) {
      return new Response(JSON.stringify({ rows: [{ clicks: 20, impressions: 1000, ctr: 0.02, position: 9.1 }] }), { status: 200 });
    }
    if (payload.dimensions?.[0] === 'query') {
      return new Response(JSON.stringify({ rows: [
        { keys: ['dor ao amamentar'], clicks: 2, impressions: 220, ctr: 0.009, position: 8.4 },
        { keys: ['consultora amamentação'], clicks: 5, impressions: 120, ctr: 0.041, position: 12.2 },
      ] }), { status: 200 });
    }
    return new Response(JSON.stringify({ rows: [
      { keys: ['https://deboralactacao.com/'], clicks: 18, impressions: 900, ctr: 0.02, position: 8.9 },
    ] }), { status: 200 });
  };

  const response = await handleSeoGoogleOverview(request(), baseEnv(), { fetch: fetchImpl });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(result.audit?.opportunities));
  assert.ok(result.audit.opportunities.some((item) => item.type === 'low_ctr_query' && item.query === 'dor ao amamentar'));
  assert.ok(result.audit.opportunities.some((item) => item.type === 'ranking_opportunity' && item.query === 'consultora amamentação'));
});

test('SEO overview reports missing Google Search Console configuration without exposing details', async () => {
  const response = await handleSeoGoogleOverview(request(), baseEnv({ ARTISYS_GOOGLE_CLIENT_SECRET: '' }), {
    fetch: async () => { throw new Error('must not run'); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_google_not_configured' });
});
