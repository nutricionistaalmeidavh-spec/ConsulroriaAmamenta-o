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
assert.match(runtime, /cloudflarePasswordHash\(/);
assert.match(runtime, /signup_nonce_hash/);
assert.match(schema, /password_hash TEXT NOT NULL/);
assert.match(schema, /signup_nonce_hash TEXT NOT NULL/);
assert.doesNotMatch(schema, /password_plain|plaintext/i);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(runtime, /\/functions\/v1\/saas-checkout/);

// Payment is confirmed first; only then is a confirmation e-mail issued.
assert.match(runtime, /async function sendPaidConfirmationEmail/);
assert.match(runtime, /checkout\?\.status !== 'paid'/);
assert.match(runtime, /status='paid'/);
assert.match(runtime, /status='email_sent'/);
assert.match(statusJs, /O e-mail de confirmação só será enviado depois da confirmação do Asaas/i);

// The real auth user/credential is materialized only after the paid e-mail confirmation link is valid.
assert.match(runtime, /async function activatePendingSignup/);
assert.match(runtime, /INSERT INTO auth_users/);
assert.match(runtime, /INSERT INTO auth_credentials/);
assert.match(runtime, /await activatePendingSignup\(env, userId\)/);
assert.match(runtime, /email_confirmed_at/);
assert.match(runtime, /email_verification_token_hash/);
assert.match(runtime, /confirmation_link_expired/);

// Purchase status reflects the Cloudflare payment -> e-mail -> activation lifecycle.
assert.match(statusJs, /email_sent/);
assert.match(statusJs, /email_confirmed/);
assert.match(completeHtml, /Cloudflare D1/i);
assert.match(completeHtml, /pagamento/i);

console.log('Pro pre-payment signup: staged in D1; e-mail is sent only after verified Asaas payment; auth activates after confirmation.');
