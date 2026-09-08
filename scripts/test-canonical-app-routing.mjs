import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolveAppIdentity } from '../src/app-identity.js';

const read = (path) => readFileSync(path, 'utf8');
const root = read('index.html');
const appEntry = read('app/index.html');
const bootstrap = read('src/bootstrap.js');
const identityRuntime = read('public/canonical-identity-runtime.js');
const authService = read('public/clinical-source/core/lib/auth-service.js');
const config = read('public/clinical-source/config.js');

assert.ok(existsSync('app/index.html'), 'canonical /app entry must exist');
assert.ok(existsSync('public/debora/index.html'), 'dedicated /debora landing must exist');
assert.match(root, /src\/bootstrap\.js/, 'root compatibility entry must keep the canonical bootstrap');
assert.match(appEntry, /src\/bootstrap\.js/, '/app must use the exact same canonical bootstrap');

assert.deepEqual(resolveAppIdentity({ pathname: '/' }), {
  productName: 'Gestão de Amamentação',
  productShortName: 'Amamentação',
  entryMode: 'compat',
  basePath: '/',
});
assert.equal(resolveAppIdentity({ pathname: '/app/' }).entryMode, 'app');
assert.equal(resolveAppIdentity({ pathname: '/app/' }).basePath, '/app/');

assert.match(bootstrap, /CANONICAL_PRODUCT_NAME/, 'bootstrap must consume canonical product identity');
assert.match(bootstrap, /genericizeClinicalHtml/, 'legacy clinical markup must be neutralized at the canonical runtime boundary');
assert.match(bootstrap, /genericizeClinicalShell/, 'legacy clinical shell copy must be neutralized without forking business logic');
assert.match(bootstrap, /replaceAll\('Débora Lactação', CANONICAL_PRODUCT_NAME\)/, 'customer branding must be replaced by generic product branding');
assert.doesNotMatch(config, /APP_NAME:\s*['\"]Débora Lactação/, 'generic config must not use Débora as product name');
assert.match(config, /APP_NAME:\s*['\"]Gestão de Amamentação/, 'generic config must expose canonical product name');

assert.match(identityRuntime, /professional_profiles/, 'canonical identity runtime must resolve the professional profile');
assert.match(identityRuntime, /owner_id=eq\.\$\{encodeURIComponent\(ownerId\)\}/, 'professional profile lookup must be owner-scoped');
assert.match(identityRuntime, /Authorization:\s*`Bearer \$\{accessToken\}`/, 'profile lookup must use the authenticated session');
assert.doesNotMatch(identityRuntime, /mothers|clinical_encounters|financial_entries/, 'identity runtime must not read clinical tables');
assert.doesNotMatch(authService, /display_name:\s*['\"]Débora/, 'generic signup must not create Débora metadata');

for (const file of ['supabase/phase-saas-foundation.sql', 'supabase/phase-saas-enforcement.sql']) {
  const sql = read(file);
  assert.doesNotMatch(sql, /update\s+(mothers|babies|appointments|clinical_encounters)\s+set\s+owner_id/i, `${file} must not re-key clinical ownership`);
  assert.doesNotMatch(sql, /delete\s+from\s+(mothers|babies|appointments|clinical_encounters)/i, `${file} must not delete clinical rows`);
}

const deboraLanding = read('public/debora/index.html');
assert.match(deboraLanding, /Débora/, 'personal landing may use Débora identity');
assert.match(deboraLanding, /href=["']\/["']/, 'personal landing access CTA must preserve the existing root app URL');
assert.doesNotMatch(deboraLanding, /saas_accounts|subscriptions|entitlements|clinical_encounters|mothers\?/, 'personal landing must remain marketing-only');

console.log('canonical multi-client routing contract: ok');
