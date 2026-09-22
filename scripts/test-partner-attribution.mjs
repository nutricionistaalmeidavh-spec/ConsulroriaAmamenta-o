import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('supabase/phase-saas-partners.sql');
const checkout = read('supabase/functions/saas-checkout/index.ts');
const webhook = read('supabase/functions/saas-billing-webhook/index.ts');
const worker = read('worker/index.js');
const app = read('public/comercial/app.js');
const index = read('public/comercial/index.html');
const plan = read('public/comercial/plan.js');
const planHtml = read('public/comercial/plano.html');
const partnerAdmin = read('public/comercial/parceiros.js');
const partnerAdminHtml = read('public/comercial/parceiros.html');

// Database is the canonical source of partner/coupon configuration and immutable sale snapshots.
assert.match(migration, /create table if not exists public\.partners/i);
assert.match(migration, /code\s+text\s+not null/i);
assert.match(migration, /commission_type/i);
assert.match(migration, /commission_value/i);
assert.match(migration, /discount_type/i);
assert.match(migration, /discount_value/i);
assert.match(migration, /create table if not exists public\.partner_attributions/i);
assert.match(migration, /checkout_request_id/i);
assert.match(migration, /subtotal_cents/i);
assert.match(migration, /discount_cents/i);
assert.match(migration, /total_cents/i);
assert.match(migration, /commission_cents/i);
assert.match(migration, /commission_status/i);
assert.match(migration, /create or replace function public\.resolve_partner_offer/i);
assert.match(migration, /create or replace function public\.apply_partner_attribution_state/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /grant all on table public\.partners to service_role/i);
assert.match(migration, /grant all on table public\.partner_attributions to service_role/i);

// Commercial entry captures both referral links and a manually supplied code.
assert.match(index, /name="partnerCode"/i);
assert.match(index, /Cupom ou código do parceiro/i);
assert.match(app, /REFERRAL_KEY/);
assert.match(app, /searchParams\.get\(['"]ref['"]\)/);
assert.match(app, /partnerCode/);
assert.match(app, /JSON\.stringify\(\{[\s\S]*partnerCode/);

// Existing signed-in customers can also attribute an upgrade.
assert.match(planHtml, /name="partnerCode"/i);
assert.match(plan, /partnerCode/);
assert.match(plan, /JSON\.stringify\(\{\s*planCode,\s*partnerCode\s*\}\)/);

// The server validates the code; the browser never decides discounts or commissions.
assert.match(checkout, /resolve_partner_offer/i);
assert.match(checkout, /partnerCode/);
assert.match(checkout, /partner_id/i);
assert.match(checkout, /partner_code_snapshot/i);
assert.match(checkout, /subtotal_cents/i);
assert.match(checkout, /discount_cents/i);
assert.match(checkout, /total_cents/i);
assert.match(checkout, /commission_cents/i);

// Provider pricing comes from the server-resolved checkout snapshot, not a browser amount.
assert.match(worker, /effectivePriceCents/);
assert.match(worker, /registered\.payload\?\.plan/);
assert.match(worker, /partnerCode/);

// Payment/reversal events converge the partner attribution with the verified Asaas payment.
assert.match(webhook, /apply_partner_attribution_state/i);
assert.match(webhook, /p_checkout_request_id/i);
assert.match(webhook, /p_provider_status/i);

// P1 admin: authenticated admin-only endpoints and a panel for partners, sales and commissions.
assert.match(worker, /PARTNER_ADMIN_EMAILS/);
assert.match(worker, /\/api\/admin\/partners/);
assert.match(worker, /\/api\/admin\/partner-sales/);
assert.match(worker, /\/api\/admin\/partner-commission/);
assert.match(partnerAdminHtml, /Parceiros e indicações/i);
assert.match(partnerAdmin, /\/api\/admin\/partners/);
assert.match(partnerAdmin, /\/api\/admin\/partner-sales/);
assert.match(partnerAdmin, /\/api\/admin\/partner-commission/);

console.log('Partner attribution, commissions and discount contracts passed.');
