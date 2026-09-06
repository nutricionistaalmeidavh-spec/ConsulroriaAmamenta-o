// Final contract: My Plan + Asaas-backed billing scaffold.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = {
  planHtml: path.join(root, 'public', 'comercial', 'plano.html'),
  planJs: path.join(root, 'public', 'comercial', 'plan.js'),
  migration: path.join(root, 'supabase', 'phase-saas-billing.sql'),
  checkout: path.join(root, 'supabase', 'functions', 'saas-checkout', 'index.ts'),
  webhook: path.join(root, 'supabase', 'functions', 'saas-billing-webhook', 'index.ts'),
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

for (const [label, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${label} missing: ${path.relative(root, file)}`);
}
if (process.exitCode) process.exit();

const html = fs.readFileSync(files.planHtml, 'utf8').toLowerCase();
const js = fs.readFileSync(files.planJs, 'utf8').toLowerCase();
const sql = fs.readFileSync(files.migration, 'utf8').toLowerCase();
const checkout = fs.readFileSync(files.checkout, 'utf8').toLowerCase();
const webhook = fs.readFileSync(files.webhook, 'utf8').toLowerCase();

for (const required of ['meu plano', 'r$ 49,90', 'r$ 499', 'pro_monthly', 'pro_annual']) {
  if (!html.includes(required)) fail(`My Plan UI missing ${required}`);
}
if (!js.includes('/api/asaas/checkout')) fail('My Plan must call the authenticated Cloudflare checkout route');

for (const required of [
  'billing_plan_catalog',
  'billing_checkout_requests',
  'billing_webhook_events',
  'apply_freemium_entitlements',
  'apply_billing_state',
  "'pro_monthly'",
  "'pro_annual'",
  '4990',
  '49900',
]) {
  if (!sql.includes(required)) fail(`billing migration missing ${required}`);
}

if (!checkout.includes('pending_provider')) fail('checkout registry must persist the provider-pending state');
if (!checkout.includes('authorization')) fail('checkout registry must use authenticated caller');
if (!checkout.includes('attach_provider_checkout')) fail('checkout registry must bind the Asaas checkout to the authenticated request');

if (!webhook.includes('x-asaas-api-key')) fail('billing bridge must require the server-side Asaas credential');
if (!webhook.includes('checkoutsession=')) fail('billing bridge must prove the payment belongs to the stored checkout session');
if (!webhook.includes('apply_billing_state')) fail('billing bridge must converge on canonical billing state RPC');
if (webhook.includes('billing_webhook_secret')) fail('billing bridge must not require an extra webhook secret');
if (webhook.includes('billing_provider')) fail('billing bridge must not require an extra provider configuration secret');

if (!process.exitCode) console.log('PASS: My Plan and Asaas billing scaffold are present');
