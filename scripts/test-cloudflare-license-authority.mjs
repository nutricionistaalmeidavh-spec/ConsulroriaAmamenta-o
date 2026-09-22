import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const worker = readFileSync('worker/index.js', 'utf8');
const domain = readFileSync('worker/domain-entry.js', 'utf8');
const bootstrap = readFileSync('worker/commercial-license-bootstrap.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const repositories = readFileSync('public/clinical-source/core/lib/repositories.js', 'utf8');
const client = readFileSync('public/clinical-source/core/lib/supabase-client.js', 'utf8');
const documents = readFileSync('public/documents-feature.js', 'utf8');
const migration = readFileSync('supabase/phase-cloudflare-license-authority.sql', 'utf8');
const versionedMigration = readFileSync('supabase/migrations/20260914210000_cloudflare_license_authority.sql', 'utf8');
const publisher = readFileSync('scripts/publish-cloudflare-license-authority.ps1', 'utf8');
const cutover = readFileSync('scripts/cutover-cloudflare-runtime.ps1', 'utf8');
const licenseSync = readFileSync('scripts/sync-license-authority-secret.ps1', 'utf8');

assert.match(wrangler, /ARTISYS_LICENSING/);
assert.match(wrangler, /obra-na-mao-comercial/);
assert.match(worker, /\/api\/license\/me/);
assert.match(worker, /\/api\/clinical\/mothers/);
assert.match(worker, /\/api\/clinical\/media\/upload/);
assert.match(worker, /ARTISYS_LICENSING/);

assert.match(domain, /ensureExplicitCommercialMarker/);
assert.match(bootstrap, /saas_accounts/);
assert.match(bootstrap, /access\?\.commercial===true/);
assert.match(bootstrap, /hasOwnedRecord\(env,'saas_accounts',user\.id\)/);
assert.match(bootstrap, /source:'d1_saas_account'/);
assert.doesNotMatch(bootstrap, /migrated_saas_account|supabase_saas_account|supabase\.co|SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY/i);

assert.doesNotMatch(plan, /\/rest\/v1\/entitlements/);
assert.doesNotMatch(plan, /\/rest\/v1\/subscriptions/);
assert.match(plan, /\/api\/license\/me/);
assert.match(repositories, /table === 'mothers'/);
assert.match(repositories, /\/api\/clinical\/mothers/);
assert.match(client, /workerRequest/);
assert.match(client, /proGatedMedia/);
assert.match(documents, /\/api\/clinical\/media\/upload/);

for (const required of [
  'drop trigger if exists mothers_saas_patient_limit',
  'drop trigger if exists clinical_media_saas_entitlement',
  'drop trigger if exists saas_accounts_bootstrap_freemium',
  'drop policy if exists mothers_owner_all',
  'drop policy if exists clinical_media_owner_insert',
  'drop policy if exists clinical_media_owner_update',
  'delete from public.entitlements',
]) assert.ok(migration.toLowerCase().includes(required), `missing migration contract: ${required}`);

assert.equal(versionedMigration, migration, 'versioned Supabase migration must exactly match the reviewed historical phase migration');
assert.doesNotMatch(migration, /apply_pro_entitlements\(p_owner_id\)/);
assert.doesNotMatch(migration, /apply_freemium_entitlements\(p_owner_id\)/);
assert.doesNotMatch(migration, /create policy[\s\S]{0,80}mothers[\s\S]{0,80}for insert/i);
assert.match(migration, /PDFs and other non-photo\/video clinical files/i);

// Historical rollback tooling is still present until the later operations-cleanup
// block, but the active licensing bootstrap above must be D1-only.
assert.match(publisher, /0008_product_license_authority\.sql/);
assert.match(publisher, /d1 execute obra-na-mao-comercial --remote/);
assert.match(publisher, /obra-na-mao-comercial\.nutricionistaalmeidavh\.workers\.dev/);
assert.match(publisher, /legacy_unmanaged/);

// Final clinical cutover must explicitly synchronize the same secret with the
// central authority so manual CEO grants continue to resolve in Débora.
assert.match(cutover, /sync-license-authority-secret\.ps1/);
assert.match(cutover, /license_authority_synced/);
assert.match(licenseSync, /LICENSE_SERVICE_SECRET/);
assert.match(licenseSync, /product-license-service\.test\.ts/);
assert.match(licenseSync, /debora-license-admin\.test\.ts/);
assert.match(licenseSync, /license-cutover-probe@artisys\.invalid/);

console.log('cloudflare license authority contract: OK');