import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const FORBIDDEN_AUTH_PATTERNS = [
  /zxowxdfhtksevhnjmeyu/i,
  /supabase\.co/i,
  /LEGACY_SUPABASE/i,
  /legacyAuth\s*\(/i,
  /legacyPasswordLogin\s*\(/i,
  /legacyUserForToken\s*\(/i,
  /syncLegacyClinicalRows/i,
  /handleCloudflarePasswordCompat/i,
];

const ACTIVE_AUTH_PATHS = [
  'worker/cloudflare-auth-runtime.js',
  'worker/cloudflare-auth-compat.js',
  'worker/cloudflare-clinical-runtime.js',
  'worker/cloudflare-billing-runtime.js',
  'worker/commercial-license-bootstrap.js',
  'worker/patient-write-runtime.js',
  'worker/package-lifecycle-runtime.js',
  'worker/cloudflare-growth-runtime.js',
  'worker/cloudflare-upsert-runtime.js',
  'worker/domain-entry.js',
];

test('active Cloudflare runtime surface has no Supabase auth fallback or migration hook', () => {
  for (const path of ACTIVE_AUTH_PATHS) {
    const source = read(path);
    for (const pattern of FORBIDDEN_AUTH_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${path} must stay free of legacy auth pattern: ${pattern}`);
    }
  }

  const auth = read('worker/cloudflare-auth-runtime.js');
  assert.match(auth, /auth_users/);
  assert.match(auth, /auth_credentials/);
  assert.match(auth, /auth_refresh_sessions/);
  assert.match(auth, /CLINICAL_AUTH_SECRET/);
});

test('legacy clinical implementation is quarantined behind the D1-only facade', () => {
  const facade = read('worker/cloudflare-clinical-runtime.js');
  const domain = read('worker/domain-entry.js');
  const authPos = domain.indexOf('handleCloudflareAuthRuntime');
  const clinicalPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');

  assert.match(facade, /cloudflare-clinical-legacy-runtime\.js/);
  assert.match(facade, /authenticateClinicalRequest/);
  assert.match(facade, /cloudflare_auth_runtime_required/);
  assert.match(facade, /handleCloudflareUpsertRuntime/);
  assert.match(facade, /handleCloudflareGrowthRuntime/);

  assert.ok(authPos >= 0, 'D1 auth runtime must be wired into the domain entry');
  assert.ok(clinicalPos >= 0, 'clinical facade must remain wired');
  assert.ok(authPos < clinicalPos, 'D1 auth routing must run before the clinical facade');
  assert.doesNotMatch(domain, /cloudflare-clinical-legacy-runtime/);
  assert.doesNotMatch(domain, /handleCloudflarePasswordCompat/);
  assert.match(domain, /requiresCloudflareIdentity/);
  assert.match(domain, /cloudflare_auth_required/);

  for (const path of ACTIVE_AUTH_PATHS.filter((item) => item !== 'worker/cloudflare-clinical-runtime.js')) {
    assert.doesNotMatch(read(path), /cloudflare-clinical-legacy-runtime\.js/, `${path} must not bypass the clinical facade`);
  }
});
