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

assert.match(wrangler, /ARTISYS_LICENSING/);
assert.match(wrangler, /obra-na-mao-comercial/);
assert.match(worker, /\/api\/license\/me/);
assert.match(worker, /\/api\/clinical\/mothers/);
assert.match(worker, /\/api\/clinical\/media\/upload/);
assert.match(worker, /ARTISYS_LICENSING/);
assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);

assert.match(domain, /ensureExplicitCommercialMarker/);
assert.match(bootstrap, /saas_accounts/);
assert.match(bootstrap, /access\?\.commercial===true/);
assert.match(bootstrap, /if\(!await isSaasAccount\(token,user\.id\)\)return/);
assert.match(bootstrap, /source:'supabase_saas_account'/);

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

assert.equal(versionedMigration, migration, 'versioned Supabase migration must exactly match the reviewed phase migration');
assert.doesNotMatch(migration, /apply_pro_entitlements\(p_owner_id\)/);
assert.doesNotMatch(migration, /apply_freemium_entitlements\(p_owner_id\)/);
assert.doesNotMatch(migration, /create policy[\s\S]{0,80}mothers[\s\S]{0,80}for insert/i);
assert.match(migration, /PDFs and other non-photo\/video clinical files/i);

for (const required of [
  "d1 migrations apply obra-na-mao-comercial --remote",
  "functions deploy saas-billing-webhook",
  "wrangler@4' deploy",
  'migration fetch --linked',
  'db push --linked --dry-run',
  'db push --linked',
  '20260914210000_cloudflare_license_authority.sql',
]) assert.ok(publisher.includes(required), `publisher missing: ${required}`);

const centralDeploy = publisher.indexOf("npx wrangler deploy --config wrangler.jsonc");
const deboraDeploy = publisher.indexOf("'wrangler@4' deploy --config wrangler.jsonc");
const finalSupabasePush = publisher.lastIndexOf("db push --linked");
assert.ok(centralDeploy >= 0 && deboraDeploy > centralDeploy, 'Central must deploy before Débora');
assert.ok(finalSupabasePush > deboraDeploy, 'Supabase final enforcement migration must run after both Workers deploy');
assert.match(publisher, /legacy_unmanaged/);
assert.match(publisher, /migration fetch --linked/);
assert.match(publisher, /--no-verify-jwt/);

console.log('cloudflare license authority contract: OK');
