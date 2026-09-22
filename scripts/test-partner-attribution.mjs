import fs from 'node:fs';
import assert from 'node:assert/strict';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const migration = read('supabase/phase-saas-partners.sql');
const checkout = read('supabase/functions/saas-checkout/index.ts');
const webhook = read('supabase/functions/saas-billing-webhook/index.ts');
const worker = read('worker/index.js');
const partnerAdminApi = read('worker/partner-admin.js');
const app = read('public/comercial/app.js');
const plan = read('public/comercial/plan.js');
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
assert.match(migration, /create or replace function public\.approve_partner_commission/i);
assert.match(migration, /least\(v_subtotal - 1, v_discount\)/i);
assert.match(migration, /enable row level security/i);
assert.match(migration, /revoke all on table public\.partners from public, anon, authenticated/i);
assert.match(migration, /revoke all on table public\.partner_attributions from public, anon, authenticated/i);
assert.match(migration, /grant all on table public\.partners to service_role/i);
assert.match(migration, /grant all on table public\.partner_attributions to service_role/i);
assert.match(migration, /revoke all on function public\.resolve_partner_offer\(text, text\) from public, anon, authenticated/i);

// Commercial entry captures both referral links and a manually supplied code without exposing pricing logic.
assert.match(app, /REFERRAL_KEY/);
assert.match(app, /searchParams\.get\(['"]ref['"]\)/);
assert.match(app, /input\.name = ['"]partnerCode['"]/);
assert.match(app, /Cupom ou código do parceiro/i);
assert.match(app, /partnerCode/);
assert.match(app, /attributionSource/);
assert.match(app, /JSON\.stringify\(\{[\s\S]*partnerCode[\s\S]*attributionSource/);
assert.doesNotMatch(app, /discountValue|commissionValue/);

// Existing signed-in customers can also attribute an upgrade.
assert.match(plan, /searchParams\.get\(['"]ref['"]\)/);
assert.match(plan, /input\.name = ['"]partnerCode['"]/);
assert.match(plan, /Cupom ou código do parceiro/i);
assert.match(plan, /partnerCode/);
assert.match(plan, /attributionSource/);
assert.match(plan, /JSON\.stringify\(\{\s*planCode,\s*partnerCode,\s*attributionSource\s*\}\)/);

// The server validates the code; the browser never decides discounts or commissions.
assert.match(checkout, /resolve_partner_offer/i);
assert.match(checkout, /partnerCode/);
assert.match(checkout, /partner_id/i);
assert.match(checkout, /partner_code_snapshot/i);
assert.match(checkout, /subtotal_cents/i);
assert.match(checkout, /discount_cents/i);
assert.match(checkout, /total_cents/i);
assert.match(checkout, /commission_cents/i);
assert.match(checkout, /invalid_partner_code/i);

// Provider pricing comes from the server-resolved checkout snapshot, not a browser amount.
assert.match(worker, /effectivePriceCents/);
assert.match(worker, /registered\.payload\?\.plan/);
assert.match(worker, /partnerCode/);
assert.match(worker, /itemValue/);

// Payment/reversal events converge the partner attribution with the verified Asaas payment.
assert.match(webhook, /apply_partner_attribution_state/i);
assert.match(webhook, /p_checkout_request_id/i);
assert.match(webhook, /p_provider_status/i);
assert.match(webhook, /mappedBy: 'subscription'/i);
assert.match(webhook, /externalSubscriptionId/i);
assert.match(migration, /commission_status = 'reversed'/i);

// P1 admin: authenticated admin-only endpoints and a panel for partners, sales and commissions.
assert.match(worker, /PARTNER_ADMIN_EMAILS/);
assert.match(worker, /\/api\/admin\/partners/);
assert.match(worker, /\/api\/admin\/partner-sales/);
assert.match(worker, /\/api\/admin\/partner-commission/);
assert.match(partnerAdminApi, /app_metadata\?\.partner_admin === true/);
assert.match(partnerAdminApi, /PARTNER_ADMIN_EMAILS/);
assert.match(partnerAdminApi, /approve_partner_commission/);
assert.doesNotMatch(partnerAdminApi, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]+['"]/);
assert.match(partnerAdminHtml, /Parceiros e indicações/i);
assert.match(partnerAdminHtml, /Comissão pendente/i);
assert.match(partnerAdmin, /\/api\/admin\/partners/);
assert.match(partnerAdmin, /\/api\/admin\/partner-sales/);
assert.match(partnerAdmin, /\/api\/admin\/partner-commission/);

// P2 reporting: filter by source dimensions and export the current result without paid dependencies.
assert.match(partnerAdminApi, /planCode/);
assert.match(partnerAdminApi, /commissionStatus/);
assert.match(partnerAdminApi, /created_at=gte/);
assert.match(partnerAdminApi, /created_at=lte/);
assert.match(partnerAdminApi, /discountCents/);
assert.match(partnerAdminHtml, /sales-plan-filter/);
assert.match(partnerAdminHtml, /sales-status-filter/);
assert.match(partnerAdminHtml, /sales-commission-filter/);
assert.match(partnerAdminHtml, /sales-from-filter/);
assert.match(partnerAdminHtml, /sales-to-filter/);
assert.match(partnerAdminHtml, /Exportar CSV/i);
assert.match(partnerAdmin, /function exportSalesCsv/);
assert.match(partnerAdmin, /text\/csv/);
assert.match(partnerAdmin, /URLSearchParams/);

console.log('Partner attribution, commissions, discounts and reporting contracts passed.');
