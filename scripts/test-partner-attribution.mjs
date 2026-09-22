import fs from 'node:fs';
import assert from 'node:assert/strict';
import { resolvePartnerOffer } from '../worker/cloudflare-billing-runtime.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const schema = read('cloudflare/billing-schema.sql');
const runtime = read('worker/cloudflare-billing-runtime.js');
const app = read('public/comercial/app.js');
const plan = read('public/comercial/plan.js');
const admin = read('public/comercial/parceiros.js');
const adminHtml = read('public/comercial/parceiros.html');

for (const marker of [
  'partners','partner_attributions','partner_code_snapshot','attribution_source','subtotal_cents','discount_cents','total_cents','commission_cents','commission_status',
]) assert.match(schema, new RegExp(marker, 'i'));
assert.match(schema, /partners_code_unique/i);
assert.match(schema, /billing_checkout_active_owner_unique/i);
assert.match(schema, /commission_status[^\n]+reversed/i);

// Referral capture remains browser-side only as a code; all money is resolved server-side.
assert.match(app, /REFERRAL_KEY/);
assert.match(app, /searchParams\.get\(['"]ref['"]\)/);
assert.match(app, /partnerCode/);
assert.match(app, /attributionSource/);
assert.doesNotMatch(app, /discountValue|commissionValue/);
assert.match(plan, /searchParams\.get\(['"]ref['"]\)/);
assert.match(plan, /partnerCode/);
assert.match(plan, /attributionSource/);

// Exercise the server-side pricing calculation with a minimal D1 double.
const fakePartner = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'Ana Parceira', code: 'ANA10', active: 1,
  commission_type: 'percent', commission_value: 10,
  discount_type: 'percent', discount_value: 20,
};
const env = {
  CLINICAL_DB: {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (/FROM partners/i.test(sql)) return fakePartner;
              throw new Error(`Unexpected D1 query: ${sql}`);
            },
          };
        },
      };
    },
  },
};
const offer = await resolvePartnerOffer(env, ' ana10 ', { price_cents: 4990 });
assert.equal(offer.partnerCode, 'ANA10');
assert.equal(offer.subtotalCents, 4990);
assert.equal(offer.discountCents, 998);
assert.equal(offer.totalCents, 3992);
assert.equal(offer.commissionCents, 399);

// Verified provider events own commission lifecycle; renewals do not create another attribution.
assert.match(runtime, /commissionStatus = commissionStatus === 'approved' \|\| commissionStatus === 'reversed' \? 'reversed' : 'cancelled'/);
assert.match(runtime, /if \(mapped\.renewal \|\| !mapped\.checkout\?\.id\) return/);
assert.match(runtime, /commission_status='approved'/);
assert.match(runtime, /PARTNER_ADMIN_EMAILS/);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);

// Admin reporting remains protected and supports filters/export without a paid analytics dependency.
assert.match(adminHtml, /Parceiros e indicações/i);
assert.match(adminHtml, /sales-plan-filter/);
assert.match(adminHtml, /sales-status-filter/);
assert.match(adminHtml, /sales-commission-filter/);
assert.match(adminHtml, /sales-from-filter/);
assert.match(adminHtml, /sales-to-filter/);
assert.match(adminHtml, /Exportar CSV/i);
assert.match(admin, /function exportSalesCsv/);
assert.match(admin, /text\/csv/);
assert.match(admin, /URLSearchParams/);
assert.match(runtime, /url\.searchParams\.get\('plan'\)/);
assert.match(runtime, /url\.searchParams\.get\('status'\)/);
assert.match(runtime, /url\.searchParams\.get\('commissionStatus'\)/);

console.log('D1 partner attribution, commissions, discounts and reporting contracts passed.');
