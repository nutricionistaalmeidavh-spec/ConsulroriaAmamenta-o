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

test('active Cloudflare auth runtime has no Supabase fallback or migration hook', () => {
  const auth = read('worker/cloudflare-auth-runtime.js');
  const compat = read('worker/cloudflare-auth-compat.js');
  const combined = `${auth}\n${compat}`;

  for (const pattern of FORBIDDEN_AUTH_PATTERNS) {
    assert.doesNotMatch(combined, pattern, `legacy auth pattern must stay out of active auth runtime: ${pattern}`);
  }

  assert.match(auth, /auth_users/);
  assert.match(auth, /auth_credentials/);
  assert.match(auth, /auth_refresh_sessions/);
  assert.match(auth, /CLINICAL_AUTH_SECRET/);
});

test('domain entry routes auth through D1 and never installs the old password compatibility handler', () => {
  const domain = read('worker/domain-entry.js');
  const authPos = domain.indexOf('handleCloudflareAuthRuntime');
  const clinicalPos = domain.indexOf('handleCloudflareClinicalRuntime(request, env)');

  assert.ok(authPos >= 0, 'D1 auth runtime must be wired into the domain entry');
  assert.ok(clinicalPos >= 0, 'clinical runtime must remain wired');
  assert.ok(authPos < clinicalPos, 'D1 auth routing must run before the general clinical runtime');
  assert.doesNotMatch(domain, /handleCloudflarePasswordCompat/);
  assert.match(domain, /requiresCloudflareIdentity/);
  assert.match(domain, /cloudflare_auth_required/);
});
