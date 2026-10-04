import test from 'node:test';
import assert from 'node:assert/strict';
import { sendTransactionalEmail, transactionalTemplate } from './transactional-email.js';

test('transactional templates use Gestão Amamentação in visible email branding', () => {
  const recovery = transactionalTemplate('password_recovery', { recoveryUrl: 'https://app.test/reset', expiresInSeconds: 1800 });
  const welcome = transactionalTemplate('welcome', { appUrl: 'https://app.test' });
  const purchase = transactionalTemplate('purchase_confirmed', { planName: 'Pro mensal' });

  assert.match(recovery.html, /Gestão Amamentação/);
  assert.equal(recovery.subject, 'Redefina sua senha — Gestão Amamentação');
  assert.match(recovery.html, /30 minutos/);

  assert.match(welcome.html, /Gestão Amamentação/);
  assert.equal(welcome.subject, 'Boas-vindas à Gestão Amamentação');

  assert.match(purchase.html, /Gestão Amamentação/);
  assert.equal(purchase.subject, 'Pagamento confirmado — Gestão Amamentação');
  assert.match(purchase.html, /Pro mensal/);
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
    assert.equal(payload.from, 'Débora Lactação <contato@deboralactacao.com>');
    assert.equal(payload.subject, 'Boas-vindas à Gestão Amamentação');
    assert.match(payload.html, /Gestão Amamentação/);
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

test('Cloudflare native EMAIL binding keeps the default sender unchanged', async () => {
  let payload;
  const result = await sendTransactionalEmail({ EMAIL: { send: async message => { payload = message; } } }, {
    kind: 'purchase_confirmed', to: 'cliente@example.com', data: { planName: 'Plano Pro anual' },
  });
  assert.equal(result.provider, 'cloudflare');
  assert.equal(payload.to, 'cliente@example.com');
  assert.equal(payload.from, 'Débora Lactação <welcome@deboralactacao.com>');
  assert.equal(payload.subject, 'Pagamento confirmado — Gestão Amamentação');
  assert.match(payload.html, /Gestão Amamentação/);
});
