import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const clinicalPath = resolve(root, 'worker', 'cloudflare-clinical-runtime.js');
const authPath = resolve(root, 'worker', 'cloudflare-auth-runtime.js');
const clinical = readFileSync(clinicalPath, 'utf8');
const auth = readFileSync(authPath, 'utf8');
const domain = readFileSync(resolve(root, 'worker', 'domain-entry.js'), 'utf8');
const commercialBootstrap = readFileSync(resolve(root, 'worker', 'commercial-license-bootstrap.js'), 'utf8');
const materializer = readFileSync(resolve(root, 'scripts', 'materialize-clinical-source.mjs'), 'utf8');
const configOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'config.js'), 'utf8');
const clientOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'core', 'lib', 'supabase-client.js'), 'utf8');
const schema = readFileSync(resolve(root, 'cloudflare', 'runtime-schema.sql'), 'utf8');
const index = readFileSync(resolve(root, 'index.html'), 'utf8');
const appIndex = readFileSync(resolve(root, 'app', 'index.html'), 'utf8');
const commercialConfig = readFileSync(resolve(root, 'public', 'comercial', 'config.js'), 'utf8');
const serviceWorker = readFileSync(resolve(root, 'public', 'sw.js'), 'utf8');
const canonicalIdentity = readFileSync(resolve(root, 'public', 'canonical-identity-runtime.js'), 'utf8');

// Clinical compatibility endpoints are implemented on D1/R2 only.
assert.match(clinical, /rest\/v1\//);
assert.match(clinical, /storage\/v1\//);
assert.match(clinical, /CLINICAL_DB/);
assert.match(clinical, /CLINICAL_FILES/);
assert.match(clinical, /SAAS_PATIENT_LIMIT_REACHED/);
assert.match(clinical, /SAAS_MEDIA_UPLOAD_NOT_ALLOWED/);
assert.match(clinical, /schedule_clinical_appointment/);
assert.match(clinical, /start_clinical_encounter/);
assert.match(clinical, /set_appointment_billing/);
assert.match(clinical, /finalize_encounter_billing/);
assert.match(clinical, /supabaseClinicalWrites:\s*false/);
assert.doesNotMatch(clinical, /supabase\.co|LEGACY_SUPABASE|legacyAuth\s*\(|legacyUserForToken|allowLegacy\s*=\s*true/i);

// Authentication authority is D1-only and separate from the clinical compatibility layer.
assert.match(auth, /auth_credentials/);
assert.match(auth, /auth_refresh_sessions/);
assert.match(auth, /CLINICAL_AUTH_SECRET/);
assert.match(auth, /PBKDF2/);
assert.match(auth, /handleCloudflareAuthRuntime/);
assert.doesNotMatch(auth, /supabase\.co|LEGACY_SUPABASE|legacyAuth\s*\(|legacyPasswordLogin/i);

// Domain routing fails closed and never delegates to a legacy Worker/backend.
assert.match(domain, /handleCloudflareAuthRuntime/);
assert.match(domain, /handleCloudflareClinicalRuntime/);
assert.match(domain, /handleCloudflareBillingRuntime/);
assert.match(domain, /if\s*\(env\.CLINICAL_DB\s*&&\s*url\.pathname\s*===\s*'\/api\/license\/me'/);
assert.match(domain, /ensureExplicitCommercialMarker\(request, env\)/);
assert.match(domain, /error:\s*'api_not_found'/);
assert.match(domain, /env\.ASSETS\.fetch/);
assert.doesNotMatch(domain, /coreWorker|\.\/index\.js/);

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

// Browser entrypoints must not install a Supabase compatibility fetch bridge.
assert.doesNotMatch(index, /cloudflare-fetch-bridge/);
assert.doesNotMatch(appIndex, /cloudflare-fetch-bridge/);

// Commercial browser traffic is same-origin Cloudflare-native.
assert.match(commercialConfig, /window\.location\.origin/);
assert.match(commercialConfig, /backend:\s*'cloudflare-d1'/);
assert.match(commercialConfig, /clientRuntimeKey:\s*'cloudflare-runtime'/);
assert.doesNotMatch(commercialConfig, /supabase/i);

// Same-origin clinical APIs carry sensitive health data and must never enter the PWA cache.
for (const prefix of ['/api/','/auth/','/rest/','/storage/']) assert.ok(serviceWorker.includes(`'${prefix}'`), `service worker missing private prefix ${prefix}`);
assert.doesNotMatch(serviceWorker, /appdeploy|supabase\.co/i);

const importedClinical = await import(pathToFileURL(clinicalPath).href);
const importedAuth = await import(pathToFileURL(authPath).href);
assert.equal(typeof importedClinical.handleCloudflareClinicalRuntime, 'function');
assert.equal(typeof importedClinical.hasOwnedRecord, 'function');
assert.equal(typeof importedAuth.handleCloudflareAuthRuntime, 'function');
assert.equal(typeof importedAuth.authenticateClinicalRequest, 'function');
assert.equal(typeof importedAuth.runtimeUserById, 'function');

console.log('Cloudflare-only clinical runtime contract: OK');
