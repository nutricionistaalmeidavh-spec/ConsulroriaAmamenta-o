import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import { normalizeCloudflareFrontendSource } from '../scripts/materialize-cloudflare-frontend.mjs';
import {
  createMemorySessionStorage,
  createSupabaseClient,
} from '../patch-source/cloudflare-license-authority/core/lib/supabase-client.js';
import domainWorker from '../worker/domain-entry.js';
import { normalizeOwnedApiRequest, ownedApiInternalPath } from '../worker/owned-api-paths.js';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else if (/\.(?:js|mjs)$/i.test(name)) out.push(path);
  }
  return out;
}

function source(path) {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Block 8 materialized browser runtime uses only owned API families', () => {
  const offenders = [];
  let combined = '';
  for (const path of walk(PUBLIC)) {
    const rel = relative(ROOT, path).replaceAll('\\', '/');
    const normalized = normalizeCloudflareFrontendSource(readFileSync(path, 'utf8'), rel);
    combined += `\n${normalized}`;
    if (/\/auth\/v1(?:\/|\b)|\/rest\/v1(?:\/|\b)|\/storage\/v1(?:\/|\b)/.test(normalized)) offenders.push(rel);
    if (/\/api\/asaas(?:\/|\b)|\/api\/sandbox\/asaas(?:\/|\b)|\/api\/webhooks\/asaas(?:\/|\b)/.test(normalized)) offenders.push(`${rel} -> legacy billing route`);
  }
  assert.deepEqual(offenders, [], `legacy public API routes remain after materialization:\n${offenders.join('\n')}`);
  assert.match(combined, /\/api\/auth\//);
  assert.match(combined, /\/api\/clinical\//);
  assert.match(combined, /\/api\/files(?:\/|\b)/);
  assert.match(combined, /\/api\/billing\//);
});

test('canonical browser client emits owned auth, clinical RPC/record and file routes', async () => {
  const calls = [];
  const storage = createMemorySessionStorage();
  const fetchImpl = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/token?grant_type=password')) {
      return json(200, {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: 'user-1', email: 'owner@example.test' },
      });
    }
    return json(200, { ok: true });
  };

  const client = createSupabaseClient({
    API_BASE_URL: 'https://app.test',
    CLIENT_RUNTIME_KEY: 'cloudflare-runtime',
  }, { fetchImpl, sessionStorage: storage });

  await client.signInWithPassword('owner@example.test', 'password-123');
  await client.rest('mothers');
  await client.rpc('claim_member_portal', {});
  await client.storageRequest('object/clinical-media/user-1/example.pdf');

  assert.deepEqual(calls, [
    'https://app.test/api/auth/token?grant_type=password',
    'https://app.test/api/clinical/records/mothers',
    'https://app.test/api/clinical/rpc/claim_member_portal',
    'https://app.test/api/files/object/clinical-media/user-1/example.pdf',
  ]);
});

test('auth, clinical and files stay native while billing alone keeps an internal compatibility map', () => {
  const domain = source('worker/domain-entry.js');
  assert.match(domain, /normalizeOwnedApiRequest/);

  assert.equal(ownedApiInternalPath('/api/auth/token'), '/api/auth/token');
  assert.equal(ownedApiInternalPath('/api/auth/signup'), '/api/auth/signup');
  assert.equal(ownedApiInternalPath('/api/clinical/records/mothers'), '/api/clinical/records/mothers');
  assert.equal(ownedApiInternalPath('/api/clinical/rpc/claim_member_portal'), '/api/clinical/rpc/claim_member_portal');
  assert.equal(ownedApiInternalPath('/api/files/object/clinical-media/u/file.pdf'), '/api/files/object/clinical-media/u/file.pdf');
  assert.equal(ownedApiInternalPath('/api/billing/checkout'), '/api/asaas/checkout');
  assert.equal(ownedApiInternalPath('/api/billing/pending-status'), '/api/asaas/pending-status');
  assert.equal(ownedApiInternalPath('/api/billing/webhooks/asaas'), '/api/webhooks/asaas');
  assert.equal(ownedApiInternalPath('/api/billing/sandbox/checkout'), '/api/sandbox/asaas/checkout');

  assert.equal(ownedApiInternalPath('/api/auth/recovery'), '/api/auth/recovery');
  assert.equal(ownedApiInternalPath('/api/clinical/patients'), '/api/clinical/patients');
});

test('native clinical API preserves method, query, headers and body without route translation', async () => {
  const request = new Request('https://app.test/api/clinical/records/mothers?select=id&limit=1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-contract': 'block-10' },
    body: JSON.stringify({ name: 'Teste' }),
  });
  const normalized = normalizeOwnedApiRequest(request);

  assert.equal(normalized.normalized, false);
  assert.equal(normalized.url.toString(), 'https://app.test/api/clinical/records/mothers?select=id&limit=1');
  assert.equal(normalized.request.method, 'POST');
  assert.equal(normalized.request.headers.get('x-contract'), 'block-10');
  assert.deepEqual(await normalized.request.json(), { name: 'Teste' });
});

test('owned files API never falls through to static assets when D1 runtime is unavailable', async () => {
  let assetCalls = 0;
  const response = await domainWorker.fetch(
    new Request('https://app.test/api/files/object/clinical-media/user-1/file.pdf?token=signed'),
    {
      ASSETS: {
        async fetch() {
          assetCalls += 1;
          return new Response('asset');
        },
      },
    },
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'cloudflare_d1_required' });
  assert.equal(assetCalls, 0);
});
