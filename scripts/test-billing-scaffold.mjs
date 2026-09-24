// Final contract: My Plan + Cloudflare D1/Asaas billing scaffold.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const builtPlanHtml = path.join(root, 'dist', 'comercial', 'plano.html');
const builtPlanJs = path.join(root, 'dist', 'comercial', 'plan.js');
const usingBuiltArtifact = fs.existsSync(builtPlanHtml) && fs.existsSync(builtPlanJs);
const files = {
  planHtml: usingBuiltArtifact ? builtPlanHtml : path.join(root, 'public', 'comercial', 'plano.html'),
  planJs: usingBuiltArtifact ? builtPlanJs : path.join(root, 'public', 'comercial', 'plan.js'),
  schema: path.join(root, 'cloudflare', 'billing-schema.sql'),
  runtime: path.join(root, 'worker', 'cloudflare-billing-runtime.js'),
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
const sql = fs.readFileSync(files.schema, 'utf8').toLowerCase();
const runtime = fs.readFileSync(files.runtime, 'utf8').toLowerCase();

for (const required of ['meu plano', 'r$ 99,90', 'r$ 999,90', 'pro_monthly', 'pro_annual']) {
  if (!html.includes(required)) fail(`My Plan UI missing ${required}`);
}
const frontendCheckoutPath = usingBuiltArtifact ? '/api/billing/checkout' : '/api/asaas/checkout';
if (!js.includes(frontendCheckoutPath)) fail(`My Plan must call the authenticated Cloudflare checkout route ${frontendCheckoutPath}`);
if (js.includes('functions/v1/saas-checkout')) fail('My Plan must not call the legacy checkout Edge Function');

for (const required of [
  'billing_plan_catalog',
  'billing_checkout_requests',
  'billing_webhook_events',
  'subscriptions',
  "'pro_monthly'",
  "'pro_annual'",
  '9990',
  '99990',
]) {
  if (!sql.includes(required)) fail(`D1 billing schema missing ${required}`);
}

// The Worker keeps the public compatibility aliases while the built browser uses owned /api/billing/* paths.
for (const required of [
  '/api/asaas/checkout',
  '/api/webhooks/asaas',
  'pending_provider',
  'external_subscription_id',
  'billing_webhook_events',
  'activatependingsignup',
]) {
  if (!runtime.includes(required)) fail(`Cloudflare billing runtime missing ${required}`);
}

if (runtime.includes('/functions/v1/saas-checkout') || runtime.includes('/functions/v1/saas-billing-webhook')) {
  fail('Cloudflare billing runtime must not call legacy Supabase Edge Functions');
}
if (runtime.includes('supabase_service_role_key')) fail('Cloudflare billing runtime must not require a Supabase service-role key');

if (!process.exitCode) console.log(`PASS: My Plan and Cloudflare D1/Asaas billing scaffold are present (${usingBuiltArtifact ? 'materialized owned billing path' : 'source alias'})`);
