import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { billingTransition, currentPeriodEnd } from '../worker/cloudflare-billing-runtime.js';

const runtime = readFileSync('worker/cloudflare-billing-runtime.js', 'utf8');
const schema = readFileSync('cloudflare/billing-schema.sql', 'utf8');

assert.equal(billingTransition('CONFIRMED'), 'active');
assert.equal(billingTransition('RECEIVED'), 'active');
assert.equal(billingTransition('OVERDUE'), 'past_due');
assert.equal(billingTransition('REFUNDED'), 'cancelled');
assert.equal(billingTransition('CHARGEBACK_REQUESTED'), 'cancelled');
assert.equal(billingTransition('PENDING'), null);

const monthlyEnd = currentPeriodEnd({ dueDate: '2026-09-22' }, 'pro_monthly');
assert.equal(monthlyEnd.slice(0, 10), '2026-10-22');
const annualEnd = currentPeriodEnd({ dueDate: '2026-09-22' }, 'pro_annual');
assert.equal(annualEnd.slice(0, 10), '2027-09-22');

// Initial payments are mapped through the verified checkout session.
assert.match(runtime, /parseCheckoutReference\(payment\?\.externalReference\)/);
assert.match(runtime, /checkoutSession=\$\{encodeURIComponent\(checkout\.external_checkout_id\)\}/);
assert.match(runtime, /rows\.some\(\(item\) => String\(item\?\.id \|\| ''\) === String\(payment\.id\)\)/);

// Later recurring charges are mapped by the subscription id persisted after the first verified charge.
assert.match(schema, /external_subscription_id TEXT/);
assert.match(schema, /subscriptions_external_idx/);
assert.match(runtime, /const subscriptionId = String\(payment\?\.subscription \|\| ''\)/);
assert.match(runtime, /WHERE provider=\? AND external_subscription_id=\? LIMIT 1/);
assert.match(runtime, /renewal:\s*true/);
assert.match(runtime, /external_subscription_id=CASE WHEN excluded\.external_subscription_id<>''/);

// First verified payment activates the staged account. A renewal only updates subscription/license state.
assert.match(runtime, /if \(mapped\.renewal \|\| !mapped\.checkout\?\.id\) return/);
assert.match(runtime, /renewal:\s*mapped\.renewal/);
assert.match(runtime, /if \(!mapped\.renewal && transition === 'active'\)/);
assert.match(runtime, /await activatePendingSignup\(env, mapped\.checkout\.owner_id\)/);
assert.doesNotMatch(runtime, /sendPaidConfirmationEmail|env\.EMAIL/);
assert.doesNotMatch(runtime, /saas-billing-webhook/);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);

// Webhook idempotency is persisted in D1.
assert.match(schema, /UNIQUE\(provider,external_event_id\)/);
assert.match(runtime, /ON CONFLICT\(provider,external_event_id\) DO NOTHING/);
assert.match(runtime, /duplicate_ignored/);

console.log('Asaas recurring renewal: D1 subscription mapping, idempotency and no duplicate first-sale activation OK.');
