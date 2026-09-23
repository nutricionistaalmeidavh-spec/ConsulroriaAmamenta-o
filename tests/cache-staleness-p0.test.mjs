import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const swSource = readFileSync('public/sw.js', 'utf8');

function loadServiceWorker({ network = async () => { throw new Error('offline'); }, cachedRoot = new Response('STALE ROOT') } = {}) {
  const handlers = {};
  const puts = [];
  const matches = [];
  const RealRequest = Request;
  class ScopedRequest extends RealRequest {
    constructor(input, init) {
      const resolved = typeof input === 'string' ? new URL(input, 'https://app.test/').toString() : input;
      super(resolved, init);
    }
  }
  const cache = {
    async put(key, response) { puts.push([String(key?.url || key), response]); },
    async match(key) {
      matches.push(String(key?.url || key));
      if (key === './') return cachedRoot;
      return undefined;
    },
  };
  const caches = {
    async keys() { return []; },
    async delete() {},
    async open() { return cache; },
  };
  vm.runInNewContext(swSource, {
    URL,
    Request: ScopedRequest,
    Response,
    caches,
    fetch: network,
    self: {
      location: { origin: 'https://app.test' },
      clients: { async claim() {} },
      skipWaiting() {},
      addEventListener(name, fn) { handlers[name] = fn; },
    },
  });
  return { handlers, puts, matches };
}

test('service worker never precaches an HTML navigation shell', async () => {
  const fetched = [];
  const { handlers, puts } = loadServiceWorker({
    network: async (request) => {
      fetched.push(request.url);
      return new Response('asset', { status: 200 });
    },
  });
  let install;
  handlers.install({ waitUntil(promise) { install = promise; } });
  await install;
  assert.equal(fetched.includes('https://app.test/'), false);
  assert.equal(puts.some(([key]) => key === './' || key === 'https://app.test/'), false);
});

test('offline navigation to /app never falls back to cached root HTML', async () => {
  const { handlers, matches } = loadServiceWorker();
  const request = new Request('https://app.test/app');
  Object.defineProperty(request, 'mode', { value: 'navigate' });
  let pending;
  handlers.fetch({ request, respondWith(value) { pending = value; } });
  const response = await pending;
  assert.equal(response.type, 'error');
  assert.equal(matches.includes('./'), false);
});

test('bootstrap forces service worker update checks to bypass HTTP cache', () => {
  const source = readFileSync('src/bootstrap.js', 'utf8');
  assert.match(source, /updateViaCache:\s*['"]none['"]/);
  assert.match(source, /registration\.update\(\)/);
});

test('Cloudflare asset responses apply no-store policy to HTML navigations and sw.js', () => {
  const source = readFileSync('worker/domain-entry.js', 'utf8');
  assert.match(source, /function\s+withAssetCachePolicy\s*\(/);
  assert.match(source, /no-store, no-cache, must-revalidate/);
  assert.match(source, /url\.pathname\s*===\s*['"]\/sw\.js['"]/);
  assert.match(source, /request\.mode\s*===\s*['"]navigate['"]/);
});
