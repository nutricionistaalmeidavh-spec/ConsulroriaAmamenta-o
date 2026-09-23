import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const runtimePath = resolve(root, 'worker', 'cloudflare-clinical-runtime.js');
const authPath = resolve(root, 'worker', 'cloudflare-auth-runtime.js');
const legacyRuntimePath = resolve(root, 'worker', 'cloudflare-clinical-legacy-runtime.js');
const runtime = readFileSync(runtimePath, 'utf8');
const legacyRuntime = readFileSync(legacyRuntimePath, 'utf8');
const domain = readFileSync(resolve(root, 'worker', 'domain-entry.js'), 'utf8');
const commercialBootstrap = readFileSync(resolve(root, 'worker', 'commercial-license-bootstrap.js'), 'utf8');
const materializer = readFileSync(resolve(root, 'scripts', 'materialize-clinical-source.mjs'), 'utf8');
const configOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'config.js'), 'utf8');
const clientOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'core', 'lib', 'supabase-client.js'), 'utf8');
const schema = readFileSync(resolve(root, 'cloudflare', 'runtime-schema.sql'), 'utf8');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const commercialConfig = readFileSync(resolve(root, 'public', 'comercial', 'config.js'), 'utf8');
const serviceWorker = readFileSync(resolve(root, 'public', 'sw.js'), 'utf8');
const canonicalIdentity = readFileSync(resolve(root, 'public', 'canonical-identity-runtime.js'), 'utf8');

// The active clinical module is now a D1-only facade. Historical compatibility
// code is quarantined in a separately named module until the REST/storage shape
// is removed in a later cutover block.
assert.match(runtime, /cloudflare-auth-runtime\.js/);
assert.match(runtime, /cloudflare-clinical-legacy-runtime\.js/);
assert.match(runtime, /handleCloudflareUpsertRuntime/);
assert.match(runtime, /handleCloudflareGrowthRuntime/);
assert.match(runtime, /cloudflare_auth_runtime_required/);
assert.doesNotMatch(runtime, /supabase\.co|LEGACY_SUPABASE|legacyAuth\s*\(|legacyUserForToken|allowLegacy\s*=\s*true/i);
assert.match(legacyRuntime, /rest\/v1\//);
assert.match(legacyRuntime, /storage\/v1\//);

assert.match(domain, /handleCloudflareClinicalRuntime/);
assert.match(domain, /handleCloudflareAuthRuntime/);
assert.match(domain, /requiresCloudflareIdentity/);
assert.match(domain, /cloudflare_auth_required/);
assert.match(domain, /if\s*\(env\.CLINICAL_DB\s*&&\s*url\.pathname\s*===\s*'\/api\/license\/me'/);
assert.match(domain, /ensureExplicitCommercialMarker\(request, env\)/);
assert.match(commercialBootstrap, /hasOwnedRecord\(env,'saas_accounts',user\.id\)/);
assert.match(commercialBootstrap, /source:'d1_saas_account'/);
assert.doesNotMatch(commercialBootstrap, /supabase\.co|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY/i);
assert.match(configOverlay, /window\.location\.origin/);
assert.match(configOverlay, /BACKEND_MODE:\s*'cloudflare'/);
assert.match(materializer, /overlay\('config\.js'\)/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_credentials/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_refresh_sessions/);
assert.match(clientOverlay, /sessionStorage = globalThis\.localStorage/);
assert.match(canonicalIdentity, /\[localStorage, sessionStorage\]/);

// Commercial browser traffic is Cloudflare-native after the billing cutover.
assert.match(commercialConfig, /window\.location\.origin/);
assert.match(commercialConfig, /backend:\s*'cloudflare-d1'/);
assert.match(commercialConfig, /clientRuntimeKey:\s*'cloudflare-runtime'/);
assert.doesNotMatch(commercialConfig, /supabase/i);

assert.doesNotMatch(index, /cloudflare-fetch-bridge/);
assert.match(index, /src\/bootstrap\.js/);

// Same-origin clinical APIs carry sensitive health data and must never enter the PWA cache.
for (const prefix of ['/api/','/auth/','/rest/','/storage/']) assert.ok(serviceWorker.includes(`'${prefix}'`), `service worker missing private prefix ${prefix}`);
assert.doesNotMatch(serviceWorker, /appdeploy/i);

const imported = await import(pathToFileURL(runtimePath).href);
const authImported = await import(pathToFileURL(authPath).href);
assert.equal(typeof imported.handleCloudflareClinicalRuntime, 'function');
assert.equal(imported.authenticateClinicalRequest, authImported.authenticateClinicalRequest, 'clinical facade must export D1-only auth');
assert.equal(imported.runtimeUserById, authImported.runtimeUserById, 'clinical facade must export D1-backed user lookup');
assert.equal(typeof imported.hasOwnedRecord, 'function');

const missingDb = await imported.handleCloudflareClinicalRuntime(new Request('https://app.test/rest/v1/mothers'), {});
assert.equal(missingDb.status, 503, 'direct compatibility calls must fail closed without D1');
assert.deepEqual(await missingDb.json(), { error: 'cloudflare_d1_required' });

console.log('Cloudflare clinical runtime contract: OK');