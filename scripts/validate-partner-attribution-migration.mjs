import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const ownerId = '11111111-1111-4111-8111-111111111111';
const checkoutId = '22222222-2222-4222-8222-222222222222';

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create table public.billing_plan_catalog (
    plan_code text primary key,
    price_cents integer not null,
    active boolean not null default true
  );
  create table public.billing_checkout_requests (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null,
    plan_code text not null references public.billing_plan_catalog(plan_code),
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  insert into public.billing_plan_catalog(plan_code, price_cents, active)
  values ('pro_monthly', 4990, true), ('pro_annual', 49900, true);
`);

const migration = readFileSync('supabase/phase-saas-partners.sql', 'utf8');
await db.exec(migration);
await db.exec(migration);

await db.exec('set role anon');
await assert.rejects(db.query('select * from public.partners'), /permission denied/);
await assert.rejects(db.query("select * from public.resolve_partner_offer('ANA10','pro_monthly')"), /permission denied/);
await db.exec('reset role; set role service_role');

const partner = await db.query(`
  insert into public.partners(name, code, partner_type, commission_type, commission_value, discount_type, discount_value)
  values ('Ana Parceira', 'ana10', 'influencer', 'percent', 10, 'percent', 20)
  returning id, code
`);
const partnerId = partner.rows[0].id;
const offer = (await db.query("select * from public.resolve_partner_offer(' ANA10 ','pro_monthly')")).rows[0];
assert.equal(offer.partner_id, partnerId);
assert.equal(offer.partner_code, 'ANA10');
assert.equal(offer.subtotal_cents, 4990);
assert.equal(offer.discount_cents, 998);
assert.equal(offer.total_cents, 3992);
assert.equal(offer.commission_cents, 399);

await db.exec(`
  insert into public.billing_checkout_requests(
    id, owner_id, plan_code, status, partner_id, partner_code_snapshot,
    attribution_source, subtotal_cents, discount_cents, total_cents, commission_cents
  ) values (
    '${checkoutId}', '${ownerId}', 'pro_monthly', 'pending_provider', '${partnerId}', 'ANA10',
    'ref_link', 4990, 998, 3992, 399
  )
`);
let attribution = (await db.query(`select * from public.partner_attributions where checkout_request_id='${checkoutId}'`)).rows[0];
assert.equal(attribution.status, 'captured');
assert.equal(attribution.commission_status, 'none');
assert.equal(attribution.total_cents, 3992);

await db.exec(`update public.billing_checkout_requests set status='paid' where id='${checkoutId}'`);
attribution = (await db.query(`select * from public.partner_attributions where checkout_request_id='${checkoutId}'`)).rows[0];
assert.equal(attribution.status, 'paid');
assert.equal(attribution.commission_status, 'pending');

await db.query(`select public.approve_partner_commission('${attribution.id}', 'admin@example.com')`);
attribution = (await db.query(`select * from public.partner_attributions where id='${attribution.id}'`)).rows[0];
assert.equal(attribution.commission_status, 'approved');

// Checkout cancellation must not erase an approved payout before the verified provider event
// can turn it into an explicit reversal.
await db.exec(`update public.billing_checkout_requests set status='cancelled' where id='${checkoutId}'`);
attribution = (await db.query(`select * from public.partner_attributions where id='${attribution.id}'`)).rows[0];
assert.equal(attribution.commission_status, 'approved');
await db.query(`select public.apply_partner_attribution_state('${checkoutId}', 'REFUNDED')`);
attribution = (await db.query(`select * from public.partner_attributions where id='${attribution.id}'`)).rows[0];
assert.equal(attribution.status, 'refunded');
assert.equal(attribution.commission_status, 'reversed');

// A 100% configured discount is capped at one cent so the Asaas charge and snapshot remain aligned.
await db.exec(`update public.partners set discount_type='percent', discount_value=100 where id='${partnerId}'`);
const floorOffer = (await db.query("select * from public.resolve_partner_offer('ANA10','pro_monthly')")).rows[0];
assert.equal(floorOffer.total_cents, 1);
assert.equal(floorOffer.discount_cents, 4989);

await db.close();
console.log('Partner migration: idempotent DDL, service-only access, server pricing, attribution lifecycle, approval reversal and paid checkout floor OK');
