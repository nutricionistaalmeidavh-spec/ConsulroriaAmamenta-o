import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'public', 'comercial', 'index.html');
const appPath = path.join(root, 'public', 'comercial', 'app.js');
const migrationPath = path.join(root, 'supabase', 'phase-saas-foundation.sql');

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const file of [htmlPath, appPath, migrationPath]) {
  if (!fs.existsSync(file)) fail(`missing ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(htmlPath, 'utf8').toLowerCase();
const app = fs.readFileSync(appPath, 'utf8').toLowerCase();
const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase();

for (const required of ['freemium', 'até 3', 'sem upload de fotos e vídeos', 'r$ 49,90', 'r$ 499', '12x']) {
  if (!html.includes(required)) fail(`pricing UI missing: ${required}`);
}

for (const plan of ['freemium', 'pro_monthly', 'pro_annual']) {
  if (!html.includes(`value="${plan}"`) && !html.includes(`data-plan="${plan}"`)) {
    fail(`missing commercial plan code ${plan}`);
  }
}

for (const feature of ['clinical_core', 'patient_limit', 'media_upload']) {
  if (!sql.includes(`'${feature}'`)) fail(`missing entitlement feature ${feature}`);
}

if (!sql.includes("'patient_limit',\n    true,\n    3")) fail('Freemium patient_limit must be 3');
if (!sql.includes("'media_upload',\n    false")) fail('Freemium media_upload must be disabled');
if (!sql.includes('bootstrap_freemium_entitlements')) fail('Freemium bootstrap trigger/function is missing');
if (!sql.includes('after insert on public.saas_accounts')) fail('Freemium bootstrap must run after SaaS account creation');
if (!sql.includes('apply_pro_entitlements')) fail('trusted Pro entitlement helper is missing');
if (!sql.includes('grant execute on function public.apply_pro_entitlements(uuid) to service_role')) {
  fail('Pro activation must be service-role only');
}

const defaultIntent = "sessionstorage.setitem('commercial.saas.plan-intent.v1', 'freemium')";
if (!html.includes(defaultIntent)) fail('Freemium must be the default plan intent');
if (!app.includes('plan_intent: selectedplan')) fail('selected commercial plan intent must persist through signup/onboarding');

if (!process.exitCode) console.log('PASS: Freemium and Pro plan contract is explicit and payment-safe');
