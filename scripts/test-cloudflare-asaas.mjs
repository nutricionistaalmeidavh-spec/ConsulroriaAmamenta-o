import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync('worker/cloudflare-billing-runtime.js', 'utf8');
const domain = readFileSync('worker/domain-entry.js', 'utf8');
const schema = readFileSync('cloudflare/billing-schema.sql', 'utf8');
const pendingSchema = readFileSync('cloudflare/billing-auth-schema.sql', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const planHtml = readFileSync('public/comercial/plano.html', 'utf8');

assert.match(wrangler, /"main"\s*:\s*"worker\/domain-entry\.js"/);
assert.match(wrangler, /"directory"\s*:\s*"\.\/dist"/);
assert.match(wrangler, /"run_worker_first"\s*:\s*true/);
assert.match(wrangler, /"keep_vars"\s*:\s*true/);

// With CLINICAL_DB bound, every commercial billing route is intercepted before the legacy worker.
assert.match(domain, /handleCloudflareBillingRuntime/);
assert.match(domain, /cloudflareBillingResponse[\s\S]*coreWorker\.fetch/);
assert.match(runtime, /if \(!env\.CLINICAL_DB \|\| !ROUTES\.has\(url\.pathname\)\) return null/);
assert.match(runtime, /\/api\/asaas\/checkout/);
assert.match(runtime, /\/api\/webhooks\/asaas/);
assert.match(runtime, /\/api\/asaas\/preauth-checkout/);
assert.match(runtime, /\/api\/admin\/partners/);

// Billing is Cloudflare/D1-native: no Supabase Edge Function, PostgreSQL RPC or service-role dependency.
assert.doesNotMatch(runtime, /supabase/i);
assert.doesNotMatch(runtime, /\/functions\/v1\//);
assert.doesNotMatch(runtime, /\/rest\/v1\/rpc\//);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(runtime, /CLINICAL_DB/);
assert.match(runtime, /billingBackend:'cloudflare-d1'/);
assert.match(runtime, /webhookVerification:'asaas_api_lookup_and_cloudflare_d1_reconciliation'/);
assert.match(runtime, /recurringReconciliation:'subscription_id'/);

// Provider calls remain server-side and secrets are only read from Worker env bindings.
assert.match(runtime, /env\.ASAAS_SECRET/);
assert.match(runtime, /env\.ASSAS_SANDBOX_SECRET/);
assert.doesNotMatch(runtime, /ASAAS_SECRET\s*=\s*['"][^'"]+['"]/);
assert.doesNotMatch(runtime, /ASSAS_SANDBOX_SECRET\s*=\s*['"][^'"]+['"]/);
assert.match(runtime, /https:\/\/api\.asaas\.com\/v3/);
assert.match(runtime, /https:\/\/api-sandbox\.asaas\.com\/v3/);
assert.match(runtime, /\/wallets\//);

// D1 owns the canonical billing state and partner snapshots.
for (const table of [
  'billing_plan_catalog','billing_checkout_requests','subscriptions','billing_webhook_events','partners','partner_attributions',
]) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
}
assert.match(pendingSchema, /CREATE TABLE IF NOT EXISTS billing_pending_signups/i);
assert.match(pendingSchema, /password_hash/i);
assert.match(pendingSchema, /signup_nonce_hash/i);
assert.doesNotMatch(pendingSchema, /password_plain|plaintext/i);

// Asaas amounts come from the D1 plan/partner snapshot, never from browser-supplied money.
assert.match(runtime, /resolvePartnerOffer/);
assert.match(runtime, /totalCents/);
assert.match(runtime, /discountCents/);
assert.match(runtime, /commissionCents/);
assert.match(runtime, /value: priced\.totalCents \/ 100/);
assert.match(runtime, /chargeTypes: \['RECURRENT'\]/);
assert.match(runtime, /maxInstallmentCount: Math\.max\(1, Number\(priced\.plan\.installment_max \|\| 12\)\)/);

// Webhook is only a trigger: payment is re-read from Asaas before D1 is mutated.
assert.match(runtime, /incoming\?\.payment\?\.id/);
assert.match(runtime, /`\/payments\/\$\{encodeURIComponent\(paymentId\)\}`/);
assert.match(runtime, /mapPayment\(env,payment,config\.provider,environment\)/);
assert.match(runtime, /billing_webhook_events/);
assert.match(runtime, /ON CONFLICT\(provider,external_event_id\) DO NOTHING/);
assert.match(runtime, /external_subscription_id=\?/);
assert.match(runtime, /renewal:mapped\.renewal/);

assert.match(plan, /fetch\('\/api\/asaas\/checkout'/);
assert.doesNotMatch(plan, /functions\/v1\/saas-checkout/);
assert.match(planHtml, /checkout é criado no Asaas pelo backend do Cloudflare/i);

console.log('Cloudflare D1 + Asaas production/sandbox contract: OK');
