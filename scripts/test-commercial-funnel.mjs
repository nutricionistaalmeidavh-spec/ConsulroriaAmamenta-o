import fs from 'node:fs';
import path from 'node:path';

// Contract for phases 3–4: commercial funnel stays isolated from the clinical entrypoint.
const root = process.cwd();
const files = {
  html: path.join(root, 'public', 'comercial', 'index.html'),
  css: path.join(root, 'public', 'comercial', 'styles.css'),
  app: path.join(root, 'public', 'comercial', 'app.js'),
  config: path.join(root, 'public', 'comercial', 'config.js'),
  migration: path.join(root, 'supabase', 'phase-saas-foundation.sql'),
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${label} file is missing: ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(files.html, 'utf8');
const app = fs.readFileSync(files.app, 'utf8');
const config = fs.readFileSync(files.config, 'utf8');
const migration = fs.readFileSync(files.migration, 'utf8');
const commercial = `${html}\n${app}\n${config}`.toLowerCase();
const sql = migration.toLowerCase();

for (const forbidden of ['débora', 'debora-lactacao', 'src/bootstrap.js', 'phase02-loader']) {
  if (commercial.includes(forbidden)) fail(`commercial app must stay isolated; found ${forbidden}`);
}

for (const required of [
  'criar conta',
  'entrar',
  'onboarding-form',
  'professionalname',
  'businessname',
  'accounttype',
]) {
  if (!commercial.includes(required.toLowerCase())) fail(`commercial funnel missing ${required}`);
}

for (const endpoint of [
  '/auth/v1/signup',
  '/auth/v1/token?grant_type=password',
  '/rest/v1/saas_accounts',
  '/rest/v1/professional_profiles',
]) {
  if (!app.includes(endpoint)) fail(`commercial app missing API endpoint ${endpoint}`);
}

if (!config.includes('sb_publishable_')) fail('browser config must use a Supabase publishable key');
if (/service[_-]?role/i.test(config)) fail('service role must never be present in browser config');
if (/eyJhbGciOi/i.test(config)) fail('legacy JWT anon key must not be committed to the commercial browser config');

if (!sql.includes('grant select, insert on table public.saas_accounts to authenticated')) {
  fail('saas_accounts must allow authenticated self-bootstrap insert');
}
if (!sql.includes('create policy saas_accounts_insert_own')) {
  fail('saas_accounts INSERT RLS policy is missing');
}
if (!sql.includes('with check ((select auth.uid()) = owner_id)')) {
  fail('saas_accounts self-bootstrap must be owner-scoped');
}

if (!process.exitCode) console.log('PASS: commercial funnel and onboarding contract are isolated and owner-scoped');
