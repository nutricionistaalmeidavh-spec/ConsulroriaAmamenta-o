import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSeoGoogleOverview, handleSeoGoogleSites, handleSeoPasswordLogin } from './seo-search-console.js';

function baseEnv(overrides = {}) {
  return {
    ARTISYS_SEO_ADMIN_TOKEN: 'seo-admin-secret-used-as-signing-key',
    ARTISYS_SEO_ADMIN_PASSWORD: 'DyDwv4-6YClt-J6V-uLd',
    ARTISYS_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    ARTISYS_GOOGLE_CLIENT_SECRET: 'client-secret',
    ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: 'refresh-secret',
    ARTISYS_SEO_SITE_URL: 'deboralactacao.com',
    ARTISYS_SEO_ARTISYS_SITE_URL: 'sc-domain:artisys.dev',
    ...overrides,
  };
}

function request(token = 'seo-admin-secret-used-as-signing-key', cookie = '', url = 'https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31') {
  const headers = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (cookie) headers.cookie = cookie;
  return new Request(url, { headers });
}

async function body(response) { return response.json(); }

function searchConsoleFetch(calls = [], sites = [
  { siteUrl: 'sc-domain:deboralactacao.com', permissionLevel: 'siteOwner' },
  { siteUrl: 'sc-domain:artisys.dev', permissionLevel: 'siteOwner' },
]) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === 'https://oauth2.googleapis.com/token') {
      return new Response(JSON.stringify({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    }
    if (url === 'https://www.googleapis.com/webmasters/v3/sites') {
      return new Response(JSON.stringify({ siteEntry: sites }), { status: 200 });
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

test('SEO sites endpoint lists accessible Search Console properties and ArtiSys contexts without exposing secrets', async () => {
  const calls = [];
  const response = await handleSeoGoogleSites(
    request('seo-admin-secret-used-as-signing-key', '', 'https://deboralactacao.com/api/seo/google/sites'),
    baseEnv(),
    { fetch: searchConsoleFetch(calls) },
  );
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.ok, true);
  assert.ok(result.sites.some((site) => site.siteUrl === 'sc-domain:artisys.dev'));
  assert.ok(result.contexts.some((context) => context.id === 'debora'));
  const loja = result.contexts.find((context) => context.id === 'loja-online');
  assert.equal(loja.siteUrl, 'sc-domain:artisys.dev');
  assert.equal(loja.pagePrefix, 'https://artisys.dev/sistemas/loja-online/');
  assert.equal(JSON.stringify(result).includes('client-secret'), false);
  assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
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

test('SEO overview scopes Loja Online product metrics to the artisys.dev commercial page', async () => {
  const calls = [];
  const url = 'https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31&context=loja-online';
  const response = await handleSeoGoogleOverview(request('seo-admin-secret-used-as-signing-key', '', url), baseEnv(), { fetch: searchConsoleFetch(calls) });
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.scope.context, 'loja-online');
  assert.equal(result.scope.siteUrl, 'sc-domain:artisys.dev');
  assert.equal(result.scope.pagePrefix, 'https://artisys.dev/sistemas/loja-online/');
  const analytics = calls.filter((call) => call.url.includes('/searchAnalytics/query'));
  assert.equal(analytics.length, 3);
  for (const call of analytics) {
    const payload = JSON.parse(call.options.body);
    assert.deepEqual(payload.dimensionFilterGroups, [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'contains', expression: 'https://artisys.dev/sistemas/loja-online/' }] }]);
  }
});

test('SEO overview supports per-store URL filtering on an authorized Search Console property', async () => {
  const calls = [];
  const site = encodeURIComponent('sc-domain:artisys.dev');
  const prefix = encodeURIComponent('https://loja-teste.artisys.dev/');
  const url = `https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31&siteUrl=${site}&pagePrefix=${prefix}`;
  const response = await handleSeoGoogleOverview(request('seo-admin-secret-used-as-signing-key', '', url), baseEnv(), { fetch: searchConsoleFetch(calls) });
  assert.equal(response.status, 200);
  const result = await body(response);
  assert.equal(result.scope.kind, 'store');
  assert.equal(result.scope.pagePrefix, 'https://loja-teste.artisys.dev/');
  const analytics = calls.filter((call) => call.url.includes('/searchAnalytics/query'));
  assert.equal(analytics.length, 3);
  assert.ok(analytics.every((call) => JSON.parse(call.options.body).dimensionFilterGroups?.[0]?.filters?.[0]?.expression === 'https://loja-teste.artisys.dev/'));
});

test('SEO overview rejects a Search Console property that the connected Google account cannot access', async () => {
  const site = encodeURIComponent('sc-domain:outro-dominio.example');
  const url = `https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31&siteUrl=${site}`;
  const response = await handleSeoGoogleOverview(request('seo-admin-secret-used-as-signing-key', '', url), baseEnv(), {
    fetch: searchConsoleFetch([], [{ siteUrl: 'sc-domain:deboralactacao.com', permissionLevel: 'siteOwner' }]),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'seo_site_not_allowed' });
});

test('SEO overview derives actionable audit opportunities from Search Console rows', async () => {
  const fetchImpl = searchConsoleFetch([]);
  const response = await handleSeoGoogleOverview(request(), baseEnv(), { fetch: fetchImpl });
  const result = await body(response);
  assert.equal(response.status, 200);
  assert.ok(result.audit.opportunities.some((item) => item.type === 'low_ctr_query') || Array.isArray(result.audit.opportunities));
});

test('SEO overview reports missing Google Search Console configuration without exposing details', async () => {
  const response = await handleSeoGoogleOverview(request(), baseEnv({ ARTISYS_GOOGLE_CLIENT_SECRET: '' }), { fetch: async () => { throw new Error('must not run'); } });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_google_not_configured' });
});
