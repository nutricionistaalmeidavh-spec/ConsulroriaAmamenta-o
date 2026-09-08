import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolveAppIdentity } from '../src/app-identity.js';

const read = (path) => readFileSync(path, 'utf8');
const root = read('index.html');
const appEntry = read('app/index.html');
const bootstrap = read('src/bootstrap.js');
const identityRuntime = read('public/canonical-identity-runtime.js');
const manifest = read('public/manifest.webmanifest');
const commercialBridge = read('public/comercial/app-entry-bridge.js');
const recovery = read('public/comercial/auth-recovery.js');

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
assert.match(bootstrap, /genericizeClinicalConfig/, 'legacy config must be neutralized only at runtime boundary');
assert.match(bootstrap, /genericizeRuntimeModule/, 'customer-specific auth defaults must be neutralized without rewriting canonical source');
assert.match(bootstrap, /genericizeClinicalHtml/, 'legacy clinical markup must be neutralized at the canonical runtime boundary');
assert.match(bootstrap, /genericizeClinicalShell/, 'legacy clinical shell copy must be neutralized without forking business logic');
assert.match(bootstrap, /replaceAll\('Débora Lactação', CANONICAL_PRODUCT_NAME\)/, 'customer branding must be replaced by generic product branding');
assert.match(bootstrap, /metadata = \{\}/, 'runtime signup must use neutral metadata');
assert.match(bootstrap, /COMMERCIAL_SESSION_KEY/, 'canonical app must bridge the authenticated commercial session');
assert.match(bootstrap, /APP_CONTEXT\.entryMode === 'app'/, 'commercial session may override legacy session only on the /app entry');

assert.match(identityRuntime, /professional_profiles/, 'canonical identity runtime must resolve the professional profile');
assert.match(identityRuntime, /owner_id=eq\.\$\{encodeURIComponent\(ownerId\)\}/, 'professional profile lookup must be owner-scoped');
assert.match(identityRuntime, /Authorization:\s*`Bearer \$\{accessToken\}`/, 'profile lookup must use the authenticated session');
assert.match(identityRuntime, /auth\/v1\/user/, 'identity runtime must hydrate user identity when an email-confirmation session lacks user payload');
assert.doesNotMatch(identityRuntime, /mothers|clinical_encounters|financial_entries/, 'identity runtime must not read clinical tables');
assert.match(identityRuntime, /commercial\.saas\.session\.v1/, 'identity may consume the same authenticated commercial session');

assert.match(commercialBridge, /CANONICAL_APP_URL = '\/app\/'/, 'completed commercial accounts must enter /app/');
assert.match(commercialBridge, /commercial\.saas\.session\.v1/, 'handoff must use the existing authenticated commercial session');
assert.match(commercialBridge, /debora-lactacao-session/, 'handoff must seed the existing clinical session key for compatibility');
assert.match(commercialBridge, /amamentacao-session/, 'handoff must also seed the canonical session key');
assert.match(commercialBridge, /data-view=\\?"complete/, 'handoff must only occur from the completed account view');
assert.match(recovery, /import '\.\/app-entry-bridge\.js'/, 'the post-auth bridge must load after the existing commercial app flow');

assert.match(manifest, /"name": "Gestão de Amamentação"/, 'installed app name must be customer-neutral');
assert.match(manifest, /"short_name": "Amamentação"/, 'installed app short name must be customer-neutral');
assert.doesNotMatch(manifest, /Débora/, 'generic PWA manifest must not use customer name');

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
