import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('authentication compatibility module contains no legacy clinical sync or first-login migration hook', () => {
  const source = read('worker/cloudflare-auth-compat.js');
  assert.doesNotMatch(source, /syncLegacyClinicalRows|repairLegacyClinicalRows|needsLegacyClinicalRepair/);
  assert.doesNotMatch(source, /handleCloudflarePasswordCompat|legacyPasswordLogin|supabase\.co/i);
});

test('D1 auth runtime never falls back to an external identity backend', () => {
  const source = read('worker/cloudflare-auth-runtime.js');
  assert.match(source, /auth_users/);
  assert.match(source, /auth_credentials/);
  assert.match(source, /auth_refresh_sessions/);
  assert.doesNotMatch(source, /legacy|supabase\.co|LEGACY_SUPABASE/i);
});

test('domain entry fails closed for protected clinical requests', () => {
  const source = read('worker/domain-entry.js');
  assert.match(source, /cloudflare_d1_required/);
  assert.match(source, /cloudflare_auth_required/);
  assert.doesNotMatch(source, /coreWorker\.fetch|cloudflare-fetch-bridge/);
});
