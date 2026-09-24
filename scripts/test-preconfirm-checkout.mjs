import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const builtApp = 'dist/comercial/app.js';
const usingBuiltArtifact = existsSync(builtApp);
const readCommercial = (relativePath) => {
  const built = `dist/comercial/${relativePath}`;
  const source = `public/comercial/${relativePath}`;
  return readFileSync(existsSync(built) ? built : source, 'utf8');
};

const app = readCommercial('app.js');
const runtime = readFileSync('worker/cloudflare-billing-runtime.js', 'utf8');
const schema = readFileSync('cloudflare/billing-auth-schema.sql', 'utf8');
const completeHtml = readCommercial('compra-concluida.html');
const statusJs = readCommercial('purchase-status.js');

// Pro can reach Asaas without an authenticated session, but credentials stay staged in D1.
assert.ok(app.includes(usingBuiltArtifact ? '/api/billing/signup' : '/api/asaas/signup'));
assert.ok(app.includes(usingBuiltArtifact ? '/api/billing/preauth-checkout' : '/api/asaas/preauth-checkout'));
assert.match(runtime, /billing_pending_signups/);
assert.match(runtime, /cloudflarePasswordHash\(/);
assert.match(runtime, /signup_nonce_hash/);
assert.match(schema, /password_hash TEXT NOT NULL/);
assert.match(schema, /signup_nonce_hash TEXT NOT NULL/);
assert.doesNotMatch(schema, /password_plain|plaintext/i);
assert.doesNotMatch(runtime, /SUPABASE_SERVICE_ROLE_KEY/);
assert.doesNotMatch(runtime, /\/functions\/v1\/saas-checkout/);

// Existing Pro accounts are handed to login instead of looking like a failed new purchase.
assert.match(app, /existing_account_login_required/);
assert.match(app, /CHECKOUT_AFTER_LOGIN_KEY/);
assert.match(app, /showView\('login'\)/);

// Asaas is the activation gate. A verified active payment materializes the account immediately.
assert.match(runtime, /async function activatePendingSignup/);
assert.match(runtime, /INSERT INTO auth_users/);
assert.match(runtime, /INSERT INTO auth_credentials/);
assert.match(runtime, /if \(!mapped\.renewal && transition === 'active'\)/);
assert.match(runtime, /await activatePendingSignup\(env, mapped\.checkout\.owner_id\)/);
assert.match(runtime, /payment_confirmed_at/);
assert.match(runtime, /status='activated'/);

// Checkout activation must not depend on transactional e-mail or confirmation links.
assert.doesNotMatch(runtime, /sendPaidConfirmationEmail/);
assert.doesNotMatch(runtime, /env\.EMAIL/);
assert.doesNotMatch(runtime, /\/api\/asaas\/confirm-email/);
assert.doesNotMatch(schema, /email_sent|email_verification_/);

// Purchase status becomes usable as soon as the verified webhook activates the account.
assert.match(statusJs, /account_activated/);
assert.match(statusJs, /Pagamento confirmado/i);
assert.doesNotMatch(statusJs, /e-mail de confirmação|email_sent|email_delivery_unavailable/i);
assert.match(completeHtml, /Cloudflare D1/i);
assert.match(completeHtml, /pagamento/i);

console.log(`Pro pre-payment signup: staged in D1; verified Asaas payment activates auth and Pro automatically, with existing-account login handoff and no e-mail gate (${usingBuiltArtifact ? 'materialized owned billing paths' : 'source aliases'}).`);
