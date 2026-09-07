import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('public/comercial/app.js', 'utf8');
const worker = readFileSync('worker/index.js', 'utf8');
const checkoutFunction = readFileSync('supabase/functions/saas-checkout/index.ts', 'utf8');
const completeHtml = readFileSync('public/comercial/compra-concluida.html', 'utf8');

// Pro signup must be able to continue to Asaas before e-mail confirmation/session exists.
assert.match(app, /crypto\.getRandomValues/);
assert.match(app, /signup_nonce/);
assert.match(app, /\/api\/asaas\/preauth-checkout/);
assert.match(app, /result\?\.user\?\.id|result\.user\.id/);
assert.match(app, /pro_monthly/);
assert.match(app, /pro_annual/);
assert.match(app, /confirmationRedirectUrl/);

// Confirmation callback should be able to recover the Supabase session from the e-mail redirect.
assert.match(app, /access_token/);
assert.match(app, /refresh_token/);
assert.match(app, /location\.hash|window\.location\.hash/);

// Worker owns provider credentials and creates the checkout from a verified pending signup.
assert.match(worker, /\/api\/asaas\/preauth-checkout/);
assert.match(worker, /create_pending_request/);
assert.match(worker, /attach_pending_provider_checkout/);
assert.match(worker, /requestSecret/);
assert.match(worker, /compra-concluida\.html/);
assert.match(worker, /env\.ASAAS_SECRET/);

// Supabase verifies the unconfirmed auth user + nonce server-side before creating billing state.
assert.match(checkoutFunction, /create_pending_request/);
assert.match(checkoutFunction, /\/auth\/v1\/admin\/users\//);
assert.match(checkoutFunction, /signup_nonce/);
assert.match(checkoutFunction, /signup_source/);
assert.match(checkoutFunction, /commercial_saas/);
assert.match(checkoutFunction, /request_secret_hash/);
assert.match(checkoutFunction, /attach_pending_provider_checkout/);
assert.match(checkoutFunction, /crypto\.subtle\.digest/);

// Post-checkout page must not claim access until both payment and e-mail confirmation are complete.
assert.match(completeHtml, /confirmar.*e-mail|confirme.*e-mail/i);
assert.match(completeHtml, /pagamento|compra|checkout/i);
assert.match(completeHtml, /acesso/i);

console.log('Pro checkout before e-mail confirmation contract: OK');
