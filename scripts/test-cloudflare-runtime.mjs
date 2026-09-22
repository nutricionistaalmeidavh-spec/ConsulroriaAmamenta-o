import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(import.meta.dirname, '..');
const runtimePath = resolve(root, 'worker', 'cloudflare-clinical-runtime.js');
const runtime = readFileSync(runtimePath, 'utf8');
const domain = readFileSync(resolve(root, 'worker', 'domain-entry.js'), 'utf8');
const commercialBootstrap = readFileSync(resolve(root, 'worker', 'commercial-license-bootstrap.js'), 'utf8');
const materializer = readFileSync(resolve(root, 'scripts', 'materialize-clinical-source.mjs'), 'utf8');
const configOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'config.js'), 'utf8');
const clientOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'core', 'lib', 'supabase-client.js'), 'utf8');
const schema = readFileSync(resolve(root, 'cloudflare', 'runtime-schema.sql'), 'utf8');
const bridge = readFileSync(resolve(root, 'src', 'cloudflare-fetch-bridge.js'), 'utf8');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const commercialConfig = readFileSync(resolve(root, 'public', 'comercial', 'config.js'), 'utf8');
const serviceWorker = readFileSync(resolve(root, 'public', 'sw.js'), 'utf8');
const canonicalIdentity = readFileSync(resolve(root, 'public', 'canonical-identity-runtime.js'), 'utf8');

assert.match(runtime, /auth\/v1\/token/);
assert.match(runtime, /rest\/v1\//);
assert.match(runtime, /storage\/v1\//);
assert.match(runtime, /CLINICAL_DB/);
assert.match(runtime, /CLINICAL_FILES/);
assert.match(runtime, /CLINICAL_AUTH_SECRET/);
assert.match(runtime, /PBKDF2/);
assert.match(runtime, /legacyAuth\('token\?grant_type=password'/);
assert.match(runtime, /SAAS_PATIENT_LIMIT_REACHED/);
assert.match(runtime, /SAAS_MEDIA_UPLOAD_NOT_ALLOWED/);
assert.match(runtime, /schedule_clinical_appointment/);
assert.match(runtime, /start_clinical_encounter/);
assert.match(runtime, /set_appointment_billing/);
assert.match(runtime, /finalize_encounter_billing/);
assert.match(runtime, /supabaseClinicalWrites:\s*false/);

assert.match(domain, /handleCloudflareClinicalRuntime/);
// Validate the actual D1 cutover behavior, not a stale explanatory comment.
assert.match(domain, /if\s*\(env\.CLINICAL_DB\s*&&\s*url\.pathname\s*===\s*'\/api\/license\/me'/);
assert.match(domain, /ensureExplicitCommercialMarker\(request, env\)/);
assert.match(commercialBootstrap, /hasOwnedRecord\(env,'saas_accounts',user\.id\)/);
assert.match(commercialBootstrap, /source='migrated_saas_account'/);
assert.match(configOverlay, /window\.location\.origin/);
assert.match(configOverlay, /BACKEND_MODE:\s*'cloudflare'/);
assert.match(materializer, /overlay\('config\.js'\)/);
assert.match(materializer, /cloudflare-d1-r2-runtime-with-legacy-auth-bridge/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_credentials/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_refresh_sessions/);
assert.match(clientOverlay, /sessionStorage = globalThis\.localStorage/);
assert.match(canonicalIdentity, /\[localStorage, sessionStorage\]/);

// Billing has moved to D1. Evaluate the published configuration instead of
// requiring the retired Supabase URL, which prevented production cutover.
const configWindow = { location: { origin: 'https://app.example.test' } };
runInNewContext(commercialConfig, { window: configWindow });
assert.equal(configWindow.SAAS_RUNTIME_CONFIG.apiBaseUrl, configWindow.location.origin);
assert.equal(configWindow.SAAS_RUNTIME_CONFIG.backend, 'cloudflare-d1');
assert.equal(configWindow.SAAS_RUNTIME_CONFIG.clientRuntimeKey, 'cloudflare-runtime');
// Existing sessions can still authenticate during migration.
assert.match(runtime, /allowLegacy = true/);

// Legacy clinical feature modules still containing the old Supabase origin are redirected
// before bootstrap/feature execution, preventing direct browser clinical reads/writes.
assert.match(bridge, /LEGACY_SUPABASE_ORIGIN/);
assert.match(bridge, /\/auth\/v1\//);
assert.match(bridge, /\/rest\/v1\//);
assert.match(bridge, /\/storage\/v1\//);
assert.match(bridge, /localStorage\.setItem\(SESSION_KEY, legacy\)/);
const bridgePos = index.indexOf('/src/cloudflare-fetch-bridge.js');
const bootstrapPos = index.indexOf('/src/bootstrap.js');
assert.ok(bridgePos >= 0 && bootstrapPos >= 0 && bridgePos < bootstrapPos, 'fetch bridge must load before bootstrap');
const appEntry = readFileSync(resolve(root, 'app', 'index.html'), 'utf8');
assert.ok(appEntry.indexOf('/src/cloudflare-fetch-bridge.js') >= 0);
assert.ok(appEntry.indexOf('/src/cloudflare-fetch-bridge.js') < appEntry.indexOf('/src/bootstrap.js'), '/app must install the same bridge before bootstrap');

// Same-origin clinical APIs carry sensitive health data and must never enter the PWA cache.
for (const prefix of ['/api/','/auth/','/rest/','/storage/']) assert.ok(serviceWorker.includes(`'${prefix}'`), `service worker missing private prefix ${prefix}`);
assert.doesNotMatch(serviceWorker, /appdeploy/i);

const imported = await import(pathToFileURL(runtimePath).href);
assert.equal(typeof imported.handleCloudflareClinicalRuntime, 'function');
assert.equal(typeof imported.authenticateClinicalRequest, 'function');
assert.equal(typeof imported.runtimeUserById, 'function');
assert.equal(typeof imported.hasOwnedRecord, 'function');

console.log('Cloudflare clinical runtime contract: OK');
