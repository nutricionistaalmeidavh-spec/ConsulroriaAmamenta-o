import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function page(file, { url = 'https://example.test/comercial/index.html', respond = () => ({}), session = true } = {}) {
  const elements = new Map();
  const element = (selector) => {
    if (!elements.has(selector)) elements.set(selector, {
      textContent: '', hidden: false, disabled: false, value: '', dataset: {},
      addEventListener() {}, querySelector() { return null; },
    });
    return elements.get(selector);
  };
  const storage = new Map(session ? [['commercial.saas.session.v1', JSON.stringify({ access_token: 'test-token' })]] : []);
  const calls = [];
  const redirects = [];
  const timers = [];
  const context = vm.createContext({
    URL, URLSearchParams, console,
    document: { querySelector: element, querySelectorAll: () => [] },
    window: { location: { href: url, origin: 'https://example.test', assign: (value) => redirects.push(value) }, requestAnimationFrame() {} },
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout: (fn) => timers.push(fn), clearTimeout() {},
    fetch: async (path, options = {}) => {
      calls.push({ path, options });
      const result = await respond(path, options);
      if (result instanceof Error) throw result;
      const status = result.httpStatus || 200;
      return { ok: status < 400, status, json: async () => result, text: async () => JSON.stringify(result), headers: { get: () => null } };
    },
  });
  let source = readFileSync(new URL(`../public/comercial/${file}`, import.meta.url), 'utf8');
  if (file === 'app.js') source = source.slice(0, source.indexOf("document.querySelectorAll('[data-open]')"));
  if (file === 'plan.js') source = source.replace(/\ninit\(\);\s*$/, '');
  if (file === 'purchase-status.js') source = source.replace(/\ncheckPayment\(\);\s*$/, '');
  vm.runInContext(source, context);
  return { run: (code) => vm.runInContext(code, context), calls, redirects, elements, element, storage, timers };
}

test('paid Pro onboarding checks effective status and never creates another checkout', async () => {
  const app = page('app.js', { respond: () => ({ status: 'active' }) });
  await app.run("selectedPlan = 'pro_monthly'; continueAfterOnboarding()");
  assert.equal(app.calls.length, 1);
  assert.match(app.calls[0].path, /\/api\/asaas\/status$/);
  assert.match(app.element('#form-message').textContent, /Pro está liberado/);
  assert.deepEqual(app.redirects, []);
});

test('confirmed URL cannot claim Pro activation or bypass server verification', async () => {
  const app = page('app.js', {
    url: 'https://example.test/comercial/index.html?confirmed=1&plan=pro_monthly',
    respond: () => ({ status: 'activation_pending' }),
  });
  await app.run('continueAfterOnboarding()');
  assert.equal(app.calls.length, 1);
  assert.doesNotMatch(app.element('#form-message').textContent, /Pro está liberado/);
  assert.deepEqual(app.redirects, ['./plano.html?asaas=success']);
});

test('free onboarding does not call payment APIs', async () => {
  const app = page('app.js');
  await app.run('continueAfterOnboarding()');
  assert.equal(app.calls.length, 0);
  assert.match(app.element('#form-message').textContent, /Perfil profissional salvo/);
});

test('status failure fails closed without charging; POST state handles activation race', async () => {
  const failed = page('app.js', { respond: () => ({ httpStatus: 503 }) });
  await assert.rejects(failed.run("startCheckout('pro_monthly')"));
  assert.equal(failed.calls.length, 1);
  const raced = page('app.js', { respond: (path) => ({ status: path.endsWith('/status') ? 'none' : 'activation_pending' }) });
  await raced.run("startCheckout('pro_monthly')");
  assert.equal(raced.calls.length, 2);
  assert.deepEqual(raced.redirects, ['./plano.html?asaas=success']);
});

test('plan purchase coalesces double clicks and reuses existing checkout', async () => {
  const plan = page('plan.js', { respond: () => ({ status: 'awaiting_payment', checkoutUrl: 'https://checkout.test/existing' }) });
  await plan.run("Promise.all([requestCheckout('pro_monthly', 'token'), requestCheckout('pro_annual', 'token')])");
  assert.equal(plan.calls.length, 1);
  assert.deepEqual(plan.redirects, ['https://checkout.test/existing']);
});

test('pending activation blocks new checkout and polling is bounded', async () => {
  const plan = page('plan.js', { respond: () => ({ status: 'activation_pending' }) });
  await plan.run("refreshPurchaseStatus('token', 0)");
  while (plan.timers.length) await plan.timers.shift()();
  assert.equal(plan.calls.length, 12);
  await plan.run("requestCheckout('pro_monthly', 'token')");
  assert.equal(plan.calls.length, 12);
  assert.match(plan.element('#plan-message').textContent, /finalizando/);
});

test('plan transient failures preserve session, while authentication failures clear it', async () => {
  for (const httpStatus of [503, 401]) {
    const plan = page('plan.js', { respond: () => ({ httpStatus, error: 'Unavailable' }) });
    await plan.run('init()');
    assert.equal(plan.storage.has('commercial.saas.session.v1'), httpStatus !== 401);
  }
});

test('purchase page distinguishes paid activation pending from effective activation', async () => {
  const purchase = page('purchase-status.js', { respond: () => ({ status: 'activation_pending' }) });
  purchase.run("proof = { userId: 'user', signupNonce: 'nonce' }");
  await purchase.run('checkPayment()');
  assert.match(purchase.element('#purchase-status').textContent, /finalizando/);
  assert.doesNotMatch(purchase.element('#purchase-status').textContent, /Pro liberado/);
});

test('preauth checkout routes paid and activation states to verification without requiring a checkout URL', async () => {
  for (const status of ['paid', 'activation_pending', 'active']) {
    const app = page('app.js', { respond: () => ({ status }), session: false });
    await app.run("startPreconfirmCheckout('user', 'nonce', 'pro_monthly')");
    assert.deepEqual(app.redirects, ['./compra-concluida.html']);
    assert.equal(app.calls.length, 1);
    assert.deepEqual(JSON.parse(app.storage.get('commercial.saas.pending-signup.v2')), { userId: 'user', signupNonce: 'nonce' });
    assert.doesNotMatch(app.element('#form-message').textContent, /Pro está liberado/);
  }
});

test('preauth checkout failures preserve proof for payment recovery', async () => {
  const app = page('app.js', { respond: () => ({ httpStatus: 503, error: 'unavailable' }), session: false });
  await assert.rejects(app.run("startPreconfirmCheckout('user', 'nonce', 'pro_monthly')"));
  assert.deepEqual(JSON.parse(app.storage.get('commercial.saas.pending-signup.v2')), { userId: 'user', signupNonce: 'nonce' });
  assert.deepEqual(app.redirects, []);
});

test('purchase polling preserves proof until effective access is confirmed', async () => {
  let result = { httpStatus: 503, error: 'unavailable' };
  const purchase = page('purchase-status.js', { respond: () => result });
  purchase.run("proof = { userId: 'user', signupNonce: 'nonce' }");
  purchase.storage.set('commercial.saas.pending-signup.v2', JSON.stringify({ userId: 'user', signupNonce: 'nonce' }));
  await purchase.run('checkPayment()');
  assert.equal(purchase.storage.has('commercial.saas.pending-signup.v2'), true);
  assert.equal(purchase.element('#check-payment').disabled, false);
  result = { status: 'activation_pending' };
  await purchase.run('checkPayment()');
  assert.equal(purchase.storage.has('commercial.saas.pending-signup.v2'), true);
  result = { status: 'account_activated' };
  await purchase.run('checkPayment()');
  assert.equal(purchase.storage.has('commercial.saas.pending-signup.v2'), false);
  assert.match(purchase.element('#purchase-status').textContent, /Pro liberado/);
});
