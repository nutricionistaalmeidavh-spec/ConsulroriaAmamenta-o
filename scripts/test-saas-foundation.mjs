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
  'public_profiles',
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
  for (const mutation of ['alter table', 'insert into', 'update', 'delete from', 'truncate table', 'drop table']) {
    const pattern = new RegExp(`${mutation.replace(' ', '\\s+')}\\s+public\\.${table}\\b`, 'i');
    if (pattern.test(sql)) fail(`clinical table ${table} is mutated via ${mutation}`);
  }
}

if (!normalized.includes("'debora-lactacao'")) fail('Débora public slug is missing');
if (!normalized.includes('clinical_encounters')) fail('legacy owner selection must use clinical encounter evidence');
if (!normalized.includes('financial_entries')) fail('legacy owner selection must use financial evidence');
if (!normalized.includes('expected exactly one legacy clinical owner')) fail('unique legacy owner guard is missing');
if (!normalized.includes('on conflict')) fail('backfill must be idempotent');
if (!normalized.includes('auth.uid()')) fail('owner-scoped RLS must use auth.uid()');

const emailLiteral = /['"][^'"\s]+@[^'"\s]+\.[^'"\s]+['"]/;
if (emailLiteral.test(sql)) fail('migration must not hardcode a personal email');

const uuidLiteral = /['"][0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}['"]/i;
if (uuidLiteral.test(sql)) fail('migration must not hardcode a generated UUID');

if (!normalized.includes('grant select on table public.public_profiles to anon')) {
  fail('public profile read grant for anon is missing');
}

if (!normalized.includes('published = true')) {
  fail('anonymous public profile policy must require published=true');
}

if (!process.exitCode) console.log('PASS: SaaS foundation contract is additive and owner-scoped');
