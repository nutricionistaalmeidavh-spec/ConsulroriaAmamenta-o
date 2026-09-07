import { readFileSync } from 'node:fs';

const app = readFileSync('public/comercial/app.js', 'utf8');

const required = [
  'function isExistingSignupResult',
  "Array.isArray(result?.user?.identities)",
  "commercial.saas.checkout-after-login.v1",
  "Este e-mail já possui uma conta. Entre com sua senha para continuar",
  "showView('login')",
  'pendingCheckoutAfterLogin',
];

for (const fragment of required) {
  if (!app.includes(fragment)) {
    throw new Error(`Missing duplicate-signup continuation contract: ${fragment}`);
  }
}

console.log('PASS: existing commercial e-mail is routed to login without a false confirmation message');
