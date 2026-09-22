import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/comercial/app.js', 'utf8');
const runtime = readFileSync('worker/cloudflare-billing-runtime.js', 'utf8');
const schema = readFileSync('cloudflare/billing-auth-schema.sql', 'utf8');
const completeHtml = readFileSync('public/comercial/compra-concluida.html', 'utf8');
const statusJs = readFileSync('public/comercial/purchase-status.js', 'utf8');

// Pro can reach Asaas without an authenticated session, but credentials stay staged in D1.
assert.match(app, /\/api\/asaas\/signup/);
assert.match(app, /\/api\/asaas\/preauth-checkout/);
assert.match(runtime, /billing_pending_signups/);
assert.match(runtime, /passwordHash\(/);
assert.match(runtime, /signup_nonce_hash/);
assert.match(schema, /password_hash TEXT NOT NULL/);
assert.match(schema, /signup_nonce_hash TEXT NOT NULL/);
assert.doesNotMatch(schema, /password_plain|plaintext/i);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(runtime, /\/functions\/v1\/saas-checkout/);

// The real auth user/credential is materialized only after a verified active payment.
assert.match(runtime, /async function activatePendingSignup/);
assert.match(runtime, /INSERT INTO auth_users/);
assert.match(runtime, /INSERT INTO auth_credentials/);
assert.match(runtime, /if \(!mapped\.renewal && transition === 'active'\) await activatePendingSignup/);
assert.match(runtime, /email_confirmed_at/);

// Purchase status reflects the Cloudflare activation lifecycle instead of a Supabase email callback.
assert.match(statusJs, /account_activated/);
assert.match(completeHtml, /Cloudflare D1/i);
assert.match(completeHtml, /ativad[oa].*pagamento|pagamento.*ativad[oa]/i);
assert.doesNotMatch(completeHtml, /confirme seu e-mail|caixa de entrada/i);

console.log('Pro pre-payment signup: staged in D1 and activated only after verified Asaas payment.');
