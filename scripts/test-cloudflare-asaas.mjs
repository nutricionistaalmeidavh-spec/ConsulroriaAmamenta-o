import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('worker/index.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const planHtml = readFileSync('public/comercial/plano.html', 'utf8');
const checkoutFunction = readFileSync('supabase/functions/saas-checkout/index.ts', 'utf8');
const billingFunction = readFileSync('supabase/functions/saas-billing-webhook/index.ts', 'utf8');

assert.match(wrangler, /"main"\s*:\s*"worker\/index\.js"/);
assert.match(wrangler, /"directory"\s*:\s*"\.\/dist"/);
assert.match(wrangler, /"run_worker_first"\s*:\s*\["\/api\/\*"\]/);
assert.match(wrangler, /"not_found_handling"\s*:\s*"single-page-application"/);
assert.match(wrangler, /"keep_vars"\s*:\s*true/);
assert.doesNotMatch(wrangler, /"secrets"\s*:/);

assert.match(worker, /env\.ASSAS_SECRET/);
assert.match(worker, /env\.ASSAS_SANDBOX_SECRET/);
assert.doesNotMatch(worker, /ASAAS_WEBHOOK_SECRET/);
assert.doesNotMatch(worker, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(worker, /asaas-access-token/);
assert.doesNotMatch(worker, /serviceFetch/);

// Production stays unchanged.
assert.match(worker, /\/api\/asaas\/checkout/);
assert.match(worker, /\/api\/webhooks\/asaas/);
assert.match(worker, /https:\/\/api\.asaas\.com\/v3/);
assert.match(worker, /https:\/\/asaas\.com\/checkoutSession\/show\?id=/);

// Sandbox is isolated behind separate routes and a separate temporary secret.
assert.match(worker, /\/api\/sandbox\/asaas\/health/);
assert.match(worker, /\/api\/sandbox\/asaas\/checkout/);
assert.match(worker, /\/api\/sandbox\/webhooks\/asaas/);
assert.match(worker, /https:\/\/api-sandbox\.asaas\.com\/v3/);
assert.match(worker, /https:\/\/sandbox\.asaas\.com\/checkoutSession\/show\//);
assert.match(worker, /ASSAS_SANDBOX_SECRET/);
assert.match(worker, /asaas_sandbox/);
assert.match(worker, /cloudflare-asaas-sandbox/);

assert.match(worker, /value:\s*49\.9/);
assert.match(worker, /value:\s*499/);
assert.match(worker, /maxInstallmentCount:\s*12/);
assert.match(worker, /chargeTypes:\s*\['RECURRENT'\]/);

// Checkout is registered in Supabase using the authenticated user's JWT before and after provider creation.
assert.match(worker, /\/functions\/v1\/saas-checkout/);
assert.match(worker, /action:\s*'create_request'/);
assert.match(worker, /action:\s*'attach_provider_checkout'/);
assert.match(worker, /saas_checkout:\$\{requestId\}/);
assert.match(worker, /externalCheckoutId:\s*result\.id/);

// A webhook is only a trigger. The provider payment is re-read before forwarding.
assert.match(worker, /payload\?\.payment\?\.id/);
assert.match(worker, /\/payments\/\$\{encodeURIComponent\(paymentId\)\}/);
assert.match(worker, /\/functions\/v1\/saas-billing-webhook/);
assert.match(worker, /'x-asaas-api-key'/);
assert.match(worker, /'x-billing-source'/);
assert.match(worker, /JSON\.stringify\(\{ paymentId \}\)/);
assert.doesNotMatch(worker, /\/rest\/v1\/rpc\/apply_billing_state/);
assert.doesNotMatch(worker, /billing_webhook_events\?/);

// Supabase checkout adapter supports production and sandbox providers without client-controlled arbitrary provider values.
assert.match(checkoutFunction, /create_request/);
assert.match(checkoutFunction, /attach_provider_checkout/);
assert.match(checkoutFunction, /owner_id=eq\.\$\{encodeURIComponent\(user\.id\)\}/);
assert.match(checkoutFunction, /external_checkout_id/);
assert.match(checkoutFunction, /status:\s*'checkout_created'/);
assert.match(checkoutFunction, /asaas_sandbox/);
assert.match(checkoutFunction, /environment/);

// Billing bridge independently verifies against the matching Asaas environment.
assert.match(billingFunction, /x-asaas-api-key/);
assert.match(billingFunction, /x-billing-source/);
assert.match(billingFunction, /api-sandbox\.asaas\.com\/v3/);
assert.match(billingFunction, /cloudflare-asaas-sandbox/);
assert.match(billingFunction, /provider:\s*environment === 'sandbox' \? 'asaas_sandbox' : 'asaas'/);
assert.match(billingFunction, /checkoutSession=\$\{encodeURIComponent\(checkoutRequest\.external_checkout_id\)\}/);
assert.match(billingFunction, /saas_checkout:/);
assert.match(billingFunction, /apply_billing_state/);
assert.match(billingFunction, /billing_webhook_events/);
assert.doesNotMatch(billingFunction, /BILLING_WEBHOOK_SECRET/);
assert.doesNotMatch(billingFunction, /BILLING_PROVIDER/);

assert.doesNotMatch(worker, /key-fingerprint/);
assert.doesNotMatch(worker, /sha256Hex/);
assert.doesNotMatch(worker, /ASSAS_SECRET\s*=\s*['"][^'"]+['"]/);
assert.doesNotMatch(worker, /ASSAS_SANDBOX_SECRET\s*=\s*['"][^'"]+['"]/);

assert.match(plan, /fetch\('\/api\/asaas\/checkout'/);
assert.doesNotMatch(plan, /sandbox/);
assert.doesNotMatch(plan, /functions\/v1\/saas-checkout/);
assert.match(planHtml, /checkout é criado no Asaas pelo backend do Cloudflare/i);

console.log('Cloudflare Asaas production + sandbox contract: OK');
