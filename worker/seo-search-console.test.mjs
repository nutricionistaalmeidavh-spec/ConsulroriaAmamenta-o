import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSeoGoogleOverview } from './seo-search-console.js';

function baseEnv(overrides = {}) {
  return {
    ARTISYS_SEO_ADMIN_TOKEN: 'seo-admin-secret',
    ARTISYS_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    ARTISYS_GOOGLE_CLIENT_SECRET: 'client-secret',
    ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: 'refresh-secret',
    ARTISYS_SEO_SITE_URL: 'deboralactacao.com',
    ...overrides,
  };
}

function request(token = 'seo-admin-secret') {
  const headers = token === null ? {} : { authorization: `Bearer ${token}` };
  return new Request('https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31', { headers });
}

async function body(response) {
  return response.json();
}

function searchConsoleFetch(calls = [], authUser = null) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify(authUser || {}), { status: authUser ? 200 : 401 });
    }
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

test('SEO overview requires a bearer credential', async () => {
  let calls = 0;
  const response = await handleSeoGoogleOverview(request(null), baseEnv(), {
    fetch: async () => { calls += 1; throw new Error('must not run'); },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'unauthorized' });
  assert.equal(calls, 0);
});

test('legacy SEO admin token remains an emergency fallback without product auth', async () => {
  const calls = [];
  const response = await handleSeoGoogleOverview(request('seo-admin-secret'), baseEnv(), {
    fetch: searchConsoleFetch(calls),
  });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(calls.some((call) => call.url.endsWith('/auth/v1/user')), false);
});

test('Google OAuth identity for the allowed owner email can access SEO without the legacy admin token', async () => {
  const calls = [];
  const user = {
    email: 'nutricionistaalmeidavh@gmail.com',
    app_metadata: { provider: 'google', providers: ['google'] },
    identities: [{ provider: 'google' }],
  };
  const response = await handleSeoGoogleOverview(request('supabase-access-token'), baseEnv({ ARTISYS_SEO_ADMIN_TOKEN: '' }), {
    fetch: searchConsoleFetch(calls, user),
  });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  const identityCall = calls.find((call) => call.url.endsWith('/auth/v1/user'));
  assert.ok(identityCall);
  assert.equal(identityCall.options.headers.authorization, 'Bearer supabase-access-token');
  assert.equal(result.googleSearch.metrics.clicks, 12);
});

test('Google OAuth identity with another email is forbidden before Search Console is called', async () => {
  const calls = [];
  const user = { email: 'outro@gmail.com', app_metadata: { provider: 'google' } };
  const response = await handleSeoGoogleOverview(request('other-token'), baseEnv(), {
    fetch: searchConsoleFetch(calls, user),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'forbidden' });
  assert.equal(calls.some((call) => call.url === 'https://oauth2.googleapis.com/token'), false);
});

test('allowed email without a Google identity is forbidden', async () => {
  const calls = [];
  const user = { email: 'nutricionistaalmeidavh@gmail.com', app_metadata: { provider: 'email', providers: ['email'] } };
  const response = await handleSeoGoogleOverview(request('password-token'), baseEnv(), {
    fetch: searchConsoleFetch(calls, user),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'forbidden' });
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
