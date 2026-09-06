import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase', 'phase-saas-foundation.sql');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(migrationPath)) {
  fail('supabase/phase-saas-foundation.sql is missing');
  process.exit();
}

const sql = fs.readFileSync(migrationPath, 'utf8');
const normalized = sql.toLowerCase();

const requiredTables = [
  'saas_accounts',
  'professional_profiles',
  'subscriptions',
  'entitlements',
];

for (const table of requiredTables) {
  if (!normalized.includes(`create table if not exists public.${table}`)) {
    fail(`missing additive table ${table}`);
  }
  if (!normalized.includes(`alter table public.${table} enable row level security`)) {
    fail(`RLS is not enabled for ${table}`);
  }
}

if (normalized.includes('create table if not exists public.public_profiles')) {
  fail('public_profiles must not exist in the commercial SaaS foundation');
}

const forbiddenDeboraCoupling = [
  'debora-lactacao',
  'dé-bora',
  'débora',
  'debora',
  'legacy_full_access',
  'pre_saas_clinical_account',
];

for (const token of forbiddenDeboraCoupling) {
  if (normalized.includes(token)) fail(`Débora coupling is forbidden in SaaS migration: ${token}`);
}

const protectedClinicalTables = [
  'mothers',
  'babies',
  'appointments',
  'clinical_encounters',
  'financial_entries',
  'clinical_media',
  'clinical_documents',
];

for (const table of protectedClinicalTables) {
  const tableReference = new RegExp(`public\\.${table}\\b`, 'i');
  if (tableReference.test(sql)) fail(`commercial SaaS migration must not reference clinical table ${table}`);
}

if (!normalized.includes('auth.uid()')) fail('owner-scoped RLS must use auth.uid()');

const emailLiteral = /['"][^'"\s]+@[^'"\s]+\.[^'"\s]+['"]/;
if (emailLiteral.test(sql)) fail('migration must not hardcode a personal email');

const uuidLiteral = /['"][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}['"]/i;
if (uuidLiteral.test(sql)) fail('migration must not hardcode a generated UUID');

if (normalized.includes('grant select on table public.public_profiles to anon')) {
  fail('commercial SaaS foundation must not expose professional landing profiles to anon');
}

if (!process.exitCode) console.log('PASS: SaaS foundation is isolated from Débora and owner-scoped');
