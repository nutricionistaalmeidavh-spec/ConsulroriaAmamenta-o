import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('completed migration keeps legacy Supabase auth and clinical sync retired', () => {
  const compat = read('worker/cloudflare-auth-compat.js');
  const domain = read('worker/domain-entry.js');

  assert.doesNotMatch(compat, /syncLegacyClinicalRows|legacyClinicalTableRows|legacyPasswordLogin|LEGACY_SUPABASE|supabase\.co/i);
  assert.doesNotMatch(domain, /handleCloudflarePasswordCompat|syncLegacyClinicalRows|legacyPasswordLogin/);
});

test('canonical clinical client is materialized from the Cloudflare overlay', () => {
  const materializer = read('scripts/materialize-clinical-source.mjs');
  const overlayClient = read('patch-source/cloudflare-license-authority/core/lib/supabase-client.js');
  const canonicalClient = read('public/clinical-source/core/lib/supabase-client.js');

  assert.match(materializer, /overlay\('core\/lib\/supabase-client\.js'\)/);
  assert.equal(canonicalClient, overlayClient, 'checked-in canonical client must match the Cloudflare source-of-truth overlay');
});

test('Cloudflare client owns refresh/retry instead of relying on the fetch bridge', () => {
  const client = read('patch-source/cloudflare-license-authority/core/lib/supabase-client.js');
  assert.match(client, /let refreshInFlight = null/);
  assert.match(client, /async function authenticatedFetch\(send\)/);
  assert.match(client, /current = await refreshSession\(\)/);
  assert.doesNotMatch(client, /cloudflare-fetch-bridge|LEGACY_SUPABASE_ORIGIN/);
});
