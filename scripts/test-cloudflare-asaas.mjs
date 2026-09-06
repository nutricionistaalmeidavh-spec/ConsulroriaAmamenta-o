import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Permanent contract for the Cloudflare-hosted Asaas adapter.
const worker = readFileSync('worker/index.js', 'utf8');
const wrangler = readFileSync('wrangler.jsonc', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const planHtml = readFileSync('public/comercial/plano.html', 'utf8');

assert.match(wrangler, /"main"\s*:\s*"worker\/index\.js"/);
assert.match(wrangler, /"directory"\s*:\s*"\.\/dist"/);
assert.match(wrangler, /"run_worker_first"\s*:\s*\["\/api\/\*"\]/);
assert.match(wrangler, /"not_found_handling"\s*:\s*"single-page-application"/);

// Asaas has exactly one private backend credential in this integration.
assert.match(worker, /env\.ASSAS_SECRET/);
assert.doesNotMatch(worker, /ASAAS_WEBHOOK_SECRET/);
assert.doesNotMatch(worker, /asaas-access-token/);
assert.match(worker, /env\.SUPABASE_SERVICE_ROLE_KEY/);

assert.match(worker, /\/api\/asaas\/checkout/);
assert.match(worker, /\/api\/webhooks\/asaas/);
assert.match(worker, /https:\/\/api\.asaas\.com\/v3/);
assert.match(worker, /https:\/\/asaas\.com\/checkoutSession\/show\?id=/);
assert.match(worker, /value:\s*49\.9/);
assert.match(worker, /value:\s*499/);
assert.match(worker, /maxInstallmentCount:\s*12/);
assert.match(worker, /chargeTypes:\s*\['RECURRENT'\]/);

// A webhook is only a trigger: billing state comes from a fresh Asaas API lookup.
assert.match(worker, /payload\?\.payment\?\.id/);
assert.match(worker, /asaasFetch\(\s*env,\s*`\/payments\/\$\{encodeURIComponent\(paymentId\)\}`/);
assert.match(worker, /parseExternalReference\(verifiedPayment\?\.externalReference\)/);
assert.match(worker, /verifiedPayment\?\.status/);
assert.match(worker, /payment:\$\{verifiedPayment\.id\}:\$\{verifiedStatus\}/);
assert.match(worker, /source:\s*'cloudflare_asaas_verified_payment'/);
assert.match(worker, /apply_billing_state/);
assert.match(worker, /resolution=ignore-duplicates/);

assert.doesNotMatch(worker, /ASSAS_SECRET\s*=\s*['"][^'"]+['"]/);
assert.doesNotMatch(worker, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/);

assert.match(plan, /fetch\('\/api\/asaas\/checkout'/);
assert.doesNotMatch(plan, /functions\/v1\/saas-checkout/);
assert.match(planHtml, /checkout é criado no Asaas pelo backend do Cloudflare/i);

console.log('Cloudflare Asaas contract: OK');
