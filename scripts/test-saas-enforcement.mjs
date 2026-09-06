import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationPath = path.join(root, 'supabase', 'phase-saas-enforcement.sql');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(migrationPath)) {
  fail('supabase/phase-saas-enforcement.sql is missing');
  process.exit();
}

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const required of [
  'saas_private.enforce_patient_limit',
  'mothers_saas_patient_limit',
  "feature_key = 'patient_limit'",
  'saas_patient_limit_reached',
  'saas_private.enforce_media_entitlement',
  'clinical_media_saas_entitlement',
  "feature_key = 'media_upload'",
  'saas_media_upload_not_allowed',
  'clinical_media_owner_insert',
  'clinical_media_owner_update',
  'saas_private.can_upload_clinical_object',
]) {
  if (!sql.includes(required)) fail(`missing enforcement contract: ${required}`);
}

if (!sql.includes("not exists (select 1 from public.saas_accounts")) {
  fail('legacy non-SaaS owners must remain unaffected');
}

if (!sql.includes("like 'image/%'") || !sql.includes("like 'video/%'")) {
  fail('media enforcement must target photo/video MIME types');
}

if (!sql.includes("application/pdf") && !sql.includes('non-media')) {
  fail('migration must document that non-photo/video uploads remain allowed');
}

if (!process.exitCode) console.log('PASS: SaaS patient/media enforcement is server-side and legacy-safe');
