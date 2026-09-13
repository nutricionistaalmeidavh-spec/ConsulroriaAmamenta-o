import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSeoGoogleOverview } from './seo-search-console.js';

function baseEnv(overrides = {}) {
  return {
    ARTISYS_SEO_ALLOWED_USER_IDS: 'admin-123',
    ARTISYS_GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com',
    ARTISYS_GOOGLE_CLIENT_SECRET: 'client-secret',
    ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN: 'refresh-secret',
    ARTISYS_SEO_SITE_URL: 'deboralactacao.com',
    ...overrides,
  };
}

function request() {
  return new Request('https://deboralactacao.com/api/seo/google/overview?startDate=2026-08-01&endDate=2026-08-31');
}

async function body(response) {
  return response.json();
}

test('SEO overview requires an authenticated product user before touching Google', async () => {
  let googleCalls = 0;
  const response = await handleSeoGoogleOverview(request(), baseEnv(), {
    authenticateUser: async () => null,
    fetch: async () => { googleCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await body(response), { error: 'unauthorized' });
  assert.equal(googleCalls, 0);
});

test('SEO overview is closed when the admin allowlist is not configured', async () => {
  let googleCalls = 0;
  const response = await handleSeoGoogleOverview(request(), baseEnv({ ARTISYS_SEO_ALLOWED_USER_IDS: '' }), {
    authenticateUser: async () => ({ id: 'admin-123' }),
    fetch: async () => { googleCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_admin_not_configured' });
  assert.equal(googleCalls, 0);
});

test('SEO overview rejects authenticated users outside the allowlist', async () => {
  let googleCalls = 0;
  const response = await handleSeoGoogleOverview(request(), baseEnv(), {
    authenticateUser: async () => ({ id: 'patient-999' }),
    fetch: async () => { googleCalls += 1; throw new Error('must not run'); },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: 'forbidden' });
  assert.equal(googleCalls, 0);
});

test('SEO overview returns real Search Console metrics for an allowed user without leaking secrets', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
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

  const response = await handleSeoGoogleOverview(request(), baseEnv(), {
    authenticateUser: async () => ({ id: 'admin-123' }),
    fetch: fetchImpl,
  });
  const result = await body(response);

  assert.equal(response.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.googleSearch.siteUrl, 'sc-domain:deboralactacao.com');
  assert.equal(result.googleSearch.metrics.impressions, 300);
  assert.equal(result.googleSearch.metrics.clicks, 12);
  assert.equal(result.googleSearch.topQueries[0].query, 'consultoria amamentação');
  assert.equal(result.googleSearch.topPages[0].page, 'https://deboralactacao.com/');
  assert.equal(JSON.stringify(result).includes('client-secret'), false);
  assert.equal(JSON.stringify(result).includes('refresh-secret'), false);
  assert.equal(JSON.stringify(result).includes('access-token'), false);
  assert.equal(calls.filter((call) => call.url === 'https://oauth2.googleapis.com/token').length, 1);
});

test('SEO overview reports missing Google secret configuration without exposing details', async () => {
  const response = await handleSeoGoogleOverview(request(), baseEnv({ ARTISYS_GOOGLE_CLIENT_SECRET: '' }), {
    authenticateUser: async () => ({ id: 'admin-123' }),
    fetch: async () => { throw new Error('must not run'); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { error: 'seo_google_not_configured' });
});
