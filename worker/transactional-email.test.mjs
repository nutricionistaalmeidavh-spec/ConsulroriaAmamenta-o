import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTransactionalEmail, transactionalTemplate } from './transactional-email.js';

test('transactional templates cover recovery, welcome and confirmed purchase', () => {
  assert.match(transactionalTemplate('password_recovery', { recoveryUrl: 'https://app.test/reset', expiresInSeconds: 1800 }).html, /30 minutos/);
  assert.match(transactionalTemplate('welcome', { appUrl: 'https://app.test' }).subject, /Boas-vindas/);
  assert.match(transactionalTemplate('purchase_confirmed', { planName: 'Pro mensal' }).html, /Pro mensal/);
});

test('Resend transport keeps credentials in headers and submits a branded message', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return Response.json({ id: 'email_1' }); };
  try {
    const result = await sendTransactionalEmail({ RESEND_API_KEY: 'secret-test', TRANSACTIONAL_EMAIL_FROM: 'Débora Lactação <contato@deboralactacao.com>' }, {
      kind: 'welcome', to: 'cliente@example.com', data: { appUrl: 'https://app.deboralactacao.com' },
    });
    assert.equal(result.provider, 'resend');
    assert.equal(request.url, 'https://api.resend.com/emails');
    assert.equal(request.options.headers.authorization, 'Bearer secret-test');
    const payload = JSON.parse(request.options.body);
    assert.deepEqual(payload.to, ['cliente@example.com']);
    assert.match(payload.html, /Débora Lactação/);
    assert.doesNotMatch(request.options.body, /secret-test/);
  } finally { globalThis.fetch = original; }
});

test('legacy recovery service binding remains supported', async () => {
  let payload;
  const delivery = { fetch: async request => { payload = await request.json(); return new Response(null, { status: 204 }); } };
  const result = await sendTransactionalEmail({ AUTH_RECOVERY_DELIVERY: delivery }, {
    kind: 'password_recovery', to: 'cliente@example.com', data: { recoveryUrl: 'https://app.test/reset', expiresInSeconds: 1800 },
  });
  assert.equal(result.provider, 'service_binding');
  assert.deepEqual(payload, { to: 'cliente@example.com', recoveryUrl: 'https://app.test/reset', expiresInSeconds: 1800 });
});

test('Cloudflare native EMAIL binding is the preferred transport', async () => {
  let payload;
  const result = await sendTransactionalEmail({ EMAIL: { send: async message => { payload = message; } } }, {
    kind: 'purchase_confirmed', to: 'cliente@example.com', data: { planName: 'Plano Pro anual' },
  });
  assert.equal(result.provider, 'cloudflare');
  assert.equal(payload.to, 'cliente@example.com');
  assert.equal(payload.from, 'Débora Lactação <welcome@deboralactacao.com>');
  assert.match(payload.subject, /Pagamento confirmado/);
});
