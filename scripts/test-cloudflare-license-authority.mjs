import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const worker = readFileSync('worker/index.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const repositories = readFileSync('public/clinical-source/core/lib/repositories.js', 'utf8');
const client = readFileSync('public/clinical-source/core/lib/supabase-client.js', 'utf8');
const documents = readFileSync('public/documents-feature.js', 'utf8');
const migration = readFileSync('supabase/phase-cloudflare-license-authority.sql', 'utf8');

assert.match(wrangler, /ARTISYS_LICENSING/);
assert.match(wrangler, /obra-na-mao-comercial/);
assert.match(worker, /\/api\/license\/me/);
assert.match(worker, /\/api\/clinical\/mothers/);
assert.match(worker, /\/api\/clinical\/media\/upload/);
assert.match(worker, /ARTISYS_LICENSING/);
assert.match(worker, /SUPABASE_SERVICE_ROLE_KEY/);

assert.doesNotMatch(plan, /\/rest\/v1\/entitlements/);
assert.match(plan, /\/api\/license\/me/);
assert.match(repositories, /workerRequest/);
assert.match(client, /workerRequest/);
assert.match(documents, /\/api\/clinical\/media\/upload/);

for (const required of [
  'drop trigger if exists mothers_saas_patient_limit',
  'drop trigger if exists clinical_media_saas_entitlement',
  'drop trigger if exists saas_accounts_bootstrap_freemium',
  'drop policy if exists clinical_media_owner_insert',
  'drop policy if exists clinical_media_owner_update',
  'delete from public.entitlements',
]) assert.ok(migration.toLowerCase().includes(required), `missing migration contract: ${required}`);

assert.doesNotMatch(migration, /apply_pro_entitlements\(p_owner_id\)/);
assert.doesNotMatch(migration, /apply_freemium_entitlements\(p_owner_id\)/);

console.log('cloudflare license authority contract: OK');
