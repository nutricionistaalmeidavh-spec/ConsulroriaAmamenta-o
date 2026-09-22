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
const domainEntry = read('worker/domain-entry.js');
const wrangler = read('wrangler.jsonc');
const postPaymentEmail = read('supabase/functions/_shared/post-payment-email.ts');
const phase02Loader = read('public/phase02-loader.js');
const phase35Loader = read('public/phase35-loader.js');
const phase68Loader = read('public/phase68-loader.js');

assert.ok(existsSync('app/index.html'), 'canonical /app entry must exist');
assert.ok(existsSync('public/debora/index.html'), 'dedicated /debora landing must exist');
assert.ok(existsSync('worker/domain-entry.js'), 'custom-domain worker entry must exist');
assert.match(root, /src\/bootstrap\.js/, 'root compatibility entry must keep the canonical bootstrap');
assert.match(appEntry, /src\/bootstrap\.js/, '/app must use the exact same canonical bootstrap');

const appBridgePos = appEntry.indexOf('/src/cloudflare-fetch-bridge.js');
const appEventBusPos = appEntry.indexOf('/eventbus-runtime.js');
const appBootstrapPos = appEntry.indexOf('/src/bootstrap.js');
assert.ok(appBridgePos >= 0, '/app must install the Cloudflare fetch bridge before legacy clinical modules');
assert.ok(appEventBusPos > appBridgePos, '/app must install EventBus after the fetch bridge');
assert.ok(appBootstrapPos > appEventBusPos, '/app bootstrap must start only after bridge and EventBus are installed');
assert.match(bootstrap, /growth-feature\.js/, 'canonical bootstrap must continue loading the growth feature');

for (const [label, source, assets] of [
  ['phase 0-2', phase02Loader, ['documents-feature.css']],
  ['phase 3-5', phase35Loader, ['album-feature.css', 'referrals-feature.css']],
  ['phase 6-8', phase68Loader, ['record-export-feature.css', 'patient-records-hub.css', 'patient-workspace.css', 'package-audit-feature.css']],
]) {
  for (const asset of assets) {
    assert.ok(source.includes(`/${asset}`), `${label} loader must use root-safe CSS path /${asset}`);
  }
}

assert.deepEqual(resolveAppIdentity({ pathname: '/' }), {
  productName: 'Gestão de Amamentação',
  productShortName: 'Amamentação',
  entryMode: 'compat',
  basePath: '/',
});
assert.equal(resolveAppIdentity({ pathname: '/app/' }).entryMode, 'app');
assert.equal(resolveAppIdentity({ pathname: '/app/' }).basePath, '/app/');
assert.deepEqual(resolveAppIdentity({ pathname: '/', hostname: 'app.deboralactacao.com' }), {
  productName: 'Gestão de Amamentação',
  productShortName: 'Amamentação',
  entryMode: 'app',
  basePath: '/',
});

assert.ok(existsSync('src/public-host-routing.js'), 'custom domain routing helper must exist');
const { resolvePublicHostRoute } = await import('../src/public-host-routing.js');
const { default: domainWorker } = await import('../worker/domain-entry.js');
assert.deepEqual(resolvePublicHostRoute('https://deboralactacao.com/?utm_source=ig'), {
  type: 'rewrite',
  pathname: '/debora/',
});
assert.deepEqual(resolvePublicHostRoute('https://deboralactacao.com/debora/?utm_source=ig'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/?utm_source=ig',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://www.deboralactacao.com/contato?x=1'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/contato?x=1',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://www.deboralactacao.com/'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://app.deboralactacao.com/'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/app/',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://app.deboralactacao.com/app/'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/app/',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://comercial.deboralactacao.com/?utm_campaign=ig'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/comercial/?utm_campaign=ig',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://comercial.deboralactacao.com/comercial/'), {
  type: 'redirect',
  location: 'https://deboralactacao.com/comercial/',
  status: 308,
});
assert.deepEqual(resolvePublicHostRoute('https://consulroriaamamenta-o.nutricionistaalmeidavh.workers.dev/debora/'), {
  type: 'passthrough',
});

let rewrittenAssetUrl;
const apexResponse = await domainWorker.fetch(new Request('https://deboralactacao.com/?utm_source=ig'), {
  ASSETS: {
    fetch(request) {
      rewrittenAssetUrl = request.url;
      return new Response('debora landing', { status: 200 });
    },
  },
});
assert.equal(apexResponse.status, 200, 'apex must return the landing response without exposing an asset redirect');
assert.equal(rewrittenAssetUrl, 'https://deboralactacao.com/debora/?utm_source=ig', 'apex must use the canonical asset directory URL');

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

assert.match(commercialBridge, /CANONICAL_APP_URL = '\/app\/'/, 'completed commercial accounts must stay on the canonical same-origin /app entry');
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

assert.match(domainEntry, /resolvePublicHostRoute/, 'custom-domain worker entry must apply the host routing helper');
assert.match(domainEntry, /env\.ASSETS\.fetch\(rewriteAssetRequest/, 'apex landing must be served by an internal asset rewrite, not a browser redirect');
assert.match(domainEntry, /url\.pathname\.startsWith\('\/api\/'\)/, 'API routes must bypass public-host redirects');
assert.match(wrangler, /"main": "worker\/domain-entry\.js"/, 'Wrangler must publish the custom-domain entry worker');
assert.match(wrangler, /"pattern": "deboralactacao\.com"/, 'apex custom domain must be declared in Wrangler');
assert.match(wrangler, /"pattern": "www\.deboralactacao\.com"/, 'www alias must be declared in Wrangler');
assert.match(wrangler, /"pattern": "app\.deboralactacao\.com"/, 'app alias must be declared in Wrangler');
assert.match(wrangler, /"pattern": "comercial\.deboralactacao\.com"/, 'commercial alias must be declared in Wrangler');
assert.match(postPaymentEmail, /https:\/\/deboralactacao\.com\/comercial\/index\.html\?confirmed=1/, 'paid email redirect must use the custom domain');
assert.doesNotMatch(postPaymentEmail, /workers\.dev/, 'paid email redirect must not depend on the technical workers.dev hostname');

const deboraLanding = read('public/debora/index.html');
assert.match(deboraLanding, /Débora/, 'personal landing may use Débora identity');
assert.match(deboraLanding, /href=["']\/app\/["']/, 'personal landing access CTA must point to same-origin /app/');
assert.match(deboraLanding, /\/debora\/public\/logo-debora\.jpeg/, 'personal landing must use root-safe logo paths');
assert.match(deboraLanding, /\/debora\/public\/debora-hero\.jpeg/, 'personal landing must use root-safe hero paths');
assert.match(deboraLanding, /href=["']\/debora\/style\.css["']/, 'personal landing stylesheet must remain valid when mounted at domain root');
assert.match(deboraLanding, /src=["']\/debora\/script\.js["']/, 'personal landing script must remain valid when mounted at domain root');
assert.match(read('public/debora/script.js'), /fetch\('\/debora\/public\/logo-motion-original\.html'\)/, 'brand motion asset must use a root-safe path');
assert.ok(existsSync('public/debora/public/logo-debora.jpeg'));
assert.ok(existsSync('public/debora/public/debora-hero.jpeg'));
assert.ok(existsSync('public/debora/public/logo-motion-original.html'));
assert.match(read('public/debora/style.css'), /#(?:FFFAF7|FEFAF7)/i, 'personal landing must preserve the light off-white visual direction');
assert.match(deboraLanding, /Como posso/, 'personal landing must preserve the approved services heading');
assert.match(deboraLanding, /te ajudar/, 'personal landing must preserve the approved italic services accent');
assert.doesNotMatch(deboraLanding, /--bg-deep\s*:\s*#160f0d/i, 'deprecated dark brown landing must not return');
assert.doesNotMatch(deboraLanding, /saas_accounts|subscriptions|entitlements|clinical_encounters|mothers\?/, 'personal landing must remain marketing-only');

console.log('canonical multi-client routing contract: ok');
