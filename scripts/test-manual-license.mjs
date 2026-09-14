import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { pathToFileURL } from 'node:url';

const migration = readFileSync('supabase/phase-saas-manual-license.sql', 'utf8');
const edge = readFileSync('supabase/functions/saas-manual-license/index.ts', 'utf8');
const plan = readFileSync('public/comercial/plan.js', 'utf8');
const onboarding = readFileSync('public/comercial/app.js', 'utf8');
const policyUrl = pathToFileURL(new URL('../supabase/functions/saas-manual-license/license-policy.mjs', import.meta.url).pathname);
const policy = await import(policyUrl.href);

assert.equal(policy.normalizeEmail('  CLIENT@Example.COM '), 'client@example.com');
assert.equal(policy.addMonthsUtc('2026-09-14T12:00:00.000Z', 6), '2027-03-14T12:00:00.000Z');
assert.equal(policy.manualGrantState({ status: 'active', expiresAt: '2026-09-13T23:59:59.000Z' }, '2026-09-14T00:00:00.000Z'), 'expired');
assert.equal(policy.manualGrantState({ status: 'active', expiresAt: '2027-03-14T00:00:00.000Z' }, '2026-09-14T00:00:00.000Z'), 'active');

for (const required of [
  'manual_license_grants',
  "'pro_6m'",
  "'semiannual'",
  'claim_manual_license',
  'has_active_pro',
  "p_plan_code in ('pro_monthly', 'pro_annual', 'pro_6m')",
]) assert.ok(migration.includes(required), `missing migration contract: ${required}`);

assert.ok(migration.includes('revoke all on table public.manual_license_grants from public, anon, authenticated'));
assert.ok(migration.includes('grant all on table public.manual_license_grants to service_role'));
assert.ok(migration.includes('revoke all on function public.claim_manual_license() from public, anon'));
assert.ok(migration.includes('grant execute on function public.claim_manual_license() to authenticated, service_role'));
assert.ok(edge.includes('x-artisys-license-secret'));
assert.ok(edge.includes("MANUAL_PLAN_CODE"));
assert.ok(edge.includes("provider: 'manual_marketplace'"));
assert.ok(plan.includes("/rest/v1/rpc/claim_manual_license"));
assert.ok(plan.includes("['pro_monthly', 'pro_annual', 'pro_6m']"));
assert.ok(onboarding.includes("/rest/v1/rpc/claim_manual_license"));

console.log('manual six-month licensing contract: OK');
