import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemorySessionStorage,
  createSupabaseClient,
} from '../patch-source/cloudflare-license-authority/core/lib/supabase-client.js';

const config = {
  SUPABASE_URL: 'https://app.test',
  SUPABASE_PUBLISHABLE_KEY: 'cloudflare-runtime',
  BACKEND_MODE: 'cloudflare',
};

function authHeader(options = {}) {
  const headers = options.headers || {};
  if (headers instanceof Headers) return headers.get('authorization');
  return headers.Authorization || headers.authorization || null;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('concurrent protected requests share one refresh and retry once with the new D1 session', async () => {
  const storage = createMemorySessionStorage();
  let refreshCalls = 0;
  const protectedCalls = new Map();

  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://app.test/auth/v1/token?grant_type=refresh_token') {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return jsonResponse(200, {
        access_token: 'fresh-access',
        refresh_token: 'fresh-refresh',
        token_type: 'bearer',
        expires_in: 3600,
      });
    }

    const key = `${options.method || 'GET'} ${url}`;
    protectedCalls.set(key, (protectedCalls.get(key) || 0) + 1);
    if (authHeader(options) === 'Bearer expired-access') {
      return jsonResponse(401, { error: 'cloudflare_auth_required' });
    }
    if (authHeader(options) === 'Bearer fresh-access') {
      return jsonResponse(200, { ok: true, url });
    }
    return jsonResponse(500, { error: 'unexpected_authorization' });
  };

  const client = createSupabaseClient(config, { fetchImpl, sessionStorage: storage });
  client.setSession({ access_token: 'expired-access', refresh_token: 'refresh-1' });

  const results = await Promise.all([
    client.rest('mothers'),
    client.rpc('record_growth_measurement', { p_baby_id: 'baby-1' }),
    client.workerRequest('/api/clinical/mothers'),
    client.storageRequest('object/documents/file.pdf'),
  ]);

  assert.equal(refreshCalls, 1, 'all simultaneous 401 responses must share one refresh request');
  assert.equal(results.length, 4);
  assert.ok(results.every((result) => result?.ok === true));
  assert.ok([...protectedCalls.values()].every((calls) => calls === 2), 'each protected request should retry exactly once');
  assert.equal(client.getSession()?.access_token, 'fresh-access');
  assert.equal(client.getSession()?.refresh_token, 'fresh-refresh');
});

test('a failed refresh clears the local session and does not replay the protected request', async () => {
  const storage = createMemorySessionStorage();
  let refreshCalls = 0;
  let protectedCalls = 0;

  const fetchImpl = async (input, options = {}) => {
    const url = String(input);
    if (url === 'https://app.test/auth/v1/token?grant_type=refresh_token') {
      refreshCalls += 1;
      return jsonResponse(401, { error: 'invalid_refresh_token' });
    }
    protectedCalls += 1;
    return jsonResponse(401, { error: 'cloudflare_auth_required' });
  };

  const client = createSupabaseClient(config, { fetchImpl, sessionStorage: storage });
  client.setSession({ access_token: 'expired-access', refresh_token: 'expired-refresh' });

  await assert.rejects(client.rest('mothers'), /Sessão expirada\. Entre novamente\./);
  assert.equal(refreshCalls, 1);
  assert.equal(protectedCalls, 1, 'request must not replay when refresh itself fails');
  assert.equal(client.getSession(), null);
});

test('a retried 401 is terminal and cannot start a second refresh loop', async () => {
  const storage = createMemorySessionStorage();
  let refreshCalls = 0;
  let protectedCalls = 0;

  const fetchImpl = async (input) => {
    const url = String(input);
    if (url === 'https://app.test/auth/v1/token?grant_type=refresh_token') {
      refreshCalls += 1;
      return jsonResponse(200, { access_token: 'still-rejected', refresh_token: 'refresh-2' });
    }
    protectedCalls += 1;
    return jsonResponse(401, { error: 'cloudflare_auth_required' });
  };

  const client = createSupabaseClient(config, { fetchImpl, sessionStorage: storage });
  client.setSession({ access_token: 'expired-access', refresh_token: 'refresh-1' });

  await assert.rejects(client.workerRequest('/api/clinical/mothers'), /Sessão expirada\. Entre novamente\./);
  assert.equal(refreshCalls, 1, 'automatic retry must never recurse into a second refresh');
  assert.equal(protectedCalls, 2, 'original request plus one retry only');
  assert.equal(client.getSession(), null);
});
