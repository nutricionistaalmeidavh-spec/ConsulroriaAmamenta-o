import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  billingTransition,
  resolvePartnerOffer,
  currentPeriodEnd,
  normalizePartnerCode,
  checkoutPayload,
  CLOUDFLARE_PBKDF2_ITERATIONS,
} from '../worker/cloudflare-billing-runtime.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('worker/cloudflare-billing-runtime.js');
const domainEntry = read('worker/domain-entry.js');
const schema = read('cloudflare/runtime-schema.sql');
const config = read('public/comercial/config.js');
const app = read('public/comercial/app.js');
const plan = read('public/comercial/plan.js');
const purchaseStatus = read('public/comercial/purchase-status.js');
const wrangler = read('wrangler.jsonc');

// Billing must be Cloudflare-native: no Supabase URL, Edge Function or service-role dependency.
assert.doesNotMatch(runtime, /supabase\.co|functions\/v1|SUPABASE_SERVICE_ROLE_KEY|serviceFetch\(/i);
assert.match(runtime, /CLINICAL_DB/);
assert.match(runtime, /billingBackend:\s*'cloudflare-d1'/);
assert.match(runtime, /subscriptionId/);
assert.match(runtime, /external_subscription_id/);
assert.doesNotMatch(runtime, /email_verification_token_hash|env\.EMAIL|\/api\/asaas\/confirm-email/);
assert.match(runtime, /await activatePendingSignup\(env, mapped\.checkout\.owner_id\)/);

// The domain entry must intercept billing before legacy coreWorker routes can run, without a dead email-confirmation route.
const billingGate = domainEntry.indexOf('handleCloudflareBillingRuntime(request, env, url)');
const legacyApi = domainEntry.indexOf('coreWorker.fetch(request, env, ctx)');
assert.ok(billingGate >= 0 && legacyApi >= 0 && billingGate < legacyApi, 'D1 billing gate must run before legacy worker');
assert.doesNotMatch(domainEntry, /\/api\/asaas\/confirm-email/);

// Commercial browser traffic stays on the Cloudflare origin and no longer carries Supabase naming.
assert.match(config, /window\.location\.origin/);
assert.match(config, /backend:\s*'cloudflare-d1'/);
assert.doesNotMatch(config, /supabase/i);
assert.doesNotMatch(app, /supabase/i);
assert.doesNotMatch(plan, /supabase/i);
assert.match(app, /apiBaseUrl/);
assert.match(plan, /apiBaseUrl/);

// D1 owns the complete billing/partner model and auth staging.
for (const table of [
  'billing_pending_signups', 'billing_plan_catalog', 'billing_checkout_requests',
  'subscriptions', 'billing_webhook_events', 'partners', 'partner_attributions',
]) {
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'i'));
}
assert.match(schema, /billing_backend','cloudflare-d1'/);
assert.match(schema, /password_iterations INTEGER NOT NULL DEFAULT 100000/);
assert.doesNotMatch(schema, /DEFAULT 210000/);

// Payment confirmation activates access directly; no e-mail transport is required by billing.
assert.doesNotMatch(wrangler, /"send_email"|BILLING_EMAIL_FROM|"name":\s*"EMAIL"/);
assert.match(purchaseStatus, /account_activated/);
assert.match(purchaseStatus, /acesso Pro liberado/i);
assert.doesNotMatch(purchaseStatus, /email_sent|email_confirmed|e-mail de confirmação/i);

assert.equal(CLOUDFLARE_PBKDF2_ITERATIONS, 100000);
assert.equal(normalizePartnerCode(' ana 10 '), 'ANA10');
assert.equal(billingTransition('CONFIRMED'), 'active');
assert.equal(billingTransition('OVERDUE'), 'past_due');
assert.equal(billingTransition('REFUNDED'), 'cancelled');
assert.equal(billingTransition('PENDING'), null);

const monthlyEnd = currentPeriodEnd({ dueDate: '2026-09-22' }, 'pro_monthly');
assert.match(monthlyEnd, /^2026-10-22T/);
const annualEnd = currentPeriodEnd({ dueDate: '2026-09-22' }, 'pro_annual');
assert.match(annualEnd, /^2027-09-22T/);

const partner = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Ana Parceira',
  code: 'ANA10',
  active: 1,
  commission_type: 'percent',
  commission_value: 10,
  discount_type: 'percent',
  discount_value: 20,
};
const fakeDb = {
  prepare(sql) {
    assert.match(sql, /FROM partners/i);
    return { bind() { return { async first() { return partner; } }; } };
  },
};
const offer = await resolvePartnerOffer({ CLINICAL_DB: fakeDb }, 'ana10', { price_cents: 4990 });
assert.equal(offer.subtotalCents, 4990);
assert.equal(offer.discountCents, 998);
assert.equal(offer.totalCents, 3992);
assert.equal(offer.commissionCents, 399);

const floorPartner = { ...partner, discount_value: 100 };
const floorDb = {
  prepare() { return { bind() { return { async first() { return floorPartner; } }; } }; },
};
const floor = await resolvePartnerOffer({ CLINICAL_DB: floorDb }, 'ANA10', { price_cents: 4990 });
assert.equal(floor.totalCents, 1);
assert.equal(floor.discountCents, 4989);

const payload = checkoutPayload('pro_monthly', '22222222-2222-4222-8222-222222222222', 'https://comercial.deboralactacao.com', 'production', 'authenticated', {
  ...offer,
  plan: { installment_max: 1 },
});
assert.equal(payload.externalReference, 'saas_checkout:22222222-2222-4222-8222-222222222222');
assert.equal(payload.items[0].value, 39.92);
assert.equal(payload.subscription.cycle, 'MONTHLY');

console.log('Cloudflare D1 billing: origin routing, Cloudflare client naming, schema, partner pricing, Asaas recurrence and automatic post-payment activation OK');
