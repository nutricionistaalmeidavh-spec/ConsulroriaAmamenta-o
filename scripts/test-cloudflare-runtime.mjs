import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const runtimePath = resolve(root, 'worker', 'cloudflare-clinical-runtime.js');
const runtime = readFileSync(runtimePath, 'utf8');
const domain = readFileSync(resolve(root, 'worker', 'domain-entry.js'), 'utf8');
const materializer = readFileSync(resolve(root, 'scripts', 'materialize-clinical-source.mjs'), 'utf8');
const configOverlay = readFileSync(resolve(root, 'patch-source', 'cloudflare-license-authority', 'config.js'), 'utf8');
const schema = readFileSync(resolve(root, 'cloudflare', 'runtime-schema.sql'), 'utf8');

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
assert.match(domain, /CLINICAL_DB is the cutover switch/);
assert.match(configOverlay, /window\.location\.origin/);
assert.match(configOverlay, /BACKEND_MODE:\s*'cloudflare'/);
assert.match(materializer, /overlay\('config\.js'\)/);
assert.match(materializer, /cloudflare-d1-r2-runtime-with-legacy-auth-bridge/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_credentials/);
assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_refresh_sessions/);

const imported = await import(pathToFileURL(runtimePath).href);
assert.equal(typeof imported.handleCloudflareClinicalRuntime, 'function');
assert.equal(typeof imported.authenticateClinicalRequest, 'function');
assert.equal(typeof imported.runtimeUserById, 'function');
assert.equal(typeof imported.hasOwnedRecord, 'function');

console.log('Cloudflare clinical runtime contract: OK');
