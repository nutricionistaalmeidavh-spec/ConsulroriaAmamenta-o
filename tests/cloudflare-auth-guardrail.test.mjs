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
  'worker/cloudflare-data-runtime.js',
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

test('clinical runtime is native D1/R2 and contains no legacy implementation bypass', () => {
  const clinical = read('worker/cloudflare-clinical-runtime.js');
  const dataRuntime = read('worker/cloudflare-data-runtime.js');
  const domain = read('worker/domain-entry.js');
  const authPos = domain.indexOf('handleCloudflareAuthRuntime');
  const clinicalPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');

  assert.match(clinical, /cloudflare-data-runtime\.js/);
  assert.match(clinical, /authenticateClinicalRequest/);
  assert.match(clinical, /handleCloudflareUpsertRuntime/);
  assert.match(clinical, /handleCloudflareGrowthRuntime/);
  assert.match(clinical, /\/api\/clinical\//);
  assert.match(clinical, /\/api\/files\//);
  assert.doesNotMatch(clinical, /cloudflare-clinical-legacy-runtime\.js/);
  assert.doesNotMatch(clinical, /\/auth\/v1|\/rest\/v1|\/storage\/v1/);

  assert.match(dataRuntime, /\/api\/clinical\/records\//);
  assert.match(dataRuntime, /\/api\/clinical\/rpc\//);
  assert.match(dataRuntime, /\/api\/files\//);
  assert.doesNotMatch(dataRuntime, /cloudflare-clinical-legacy-runtime\.js/);
  assert.doesNotMatch(dataRuntime, /\/auth\/v1|\/rest\/v1|\/storage\/v1/);

  assert.ok(authPos >= 0, 'D1 auth runtime must be wired into the domain entry');
  assert.ok(clinicalPos >= 0, 'native clinical runtime must remain wired');
  assert.ok(authPos < clinicalPos, 'D1 auth routing must run before the clinical runtime');
  assert.doesNotMatch(domain, /cloudflare-clinical-legacy-runtime/);
  assert.doesNotMatch(domain, /handleCloudflarePasswordCompat/);
  assert.match(domain, /requiresCloudflareIdentity/);
  assert.match(domain, /cloudflare_auth_required/);

  for (const path of ACTIVE_AUTH_PATHS) {
    assert.doesNotMatch(read(path), /cloudflare-clinical-legacy-runtime\.js/, `${path} must not import the retired clinical runtime`);
  }
});
