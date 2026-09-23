import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import domainWorker from '../worker/domain-entry.js';

const domainSource = readFileSync(new URL('../worker/domain-entry.js', import.meta.url), 'utf8');
const wranglerSource = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

function assetsSpy(response = new Response('asset', { status: 200 })) {
  const calls = [];
  return {
    calls,
    binding: {
      async fetch(request) {
        calls.push(new URL(request.url).pathname);
        return response.clone();
      },
    },
  };
}

test('Block 7 entrypoint no longer imports or delegates to worker/index.js', () => {
  assert.doesNotMatch(domainSource, /import\s+coreWorker\s+from\s+['"]\.\/index\.js['"]/);
  assert.doesNotMatch(domainSource, /coreWorker\.fetch\s*\(/);
  assert.match(domainSource, /env\.ASSETS\.fetch\s*\(/);
  assert.match(wranglerSource, /"main"\s*:\s*"worker\/domain-entry\.js"/);
});

test('unknown API paths terminate with 404 and never fall through to assets', async () => {
  const assets = assetsSpy();
  const response = await domainWorker.fetch(
    new Request('https://app.test/api/does-not-exist'),
    { ASSETS: assets.binding },
    {},
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'api_not_found' });
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.deepEqual(assets.calls, []);
});

test('known D1-protected API fails closed with 503 when D1 is unavailable', async () => {
  const assets = assetsSpy();
  const response = await domainWorker.fetch(
    new Request('https://app.test/api/license/me', { headers: { authorization: 'Bearer unusable' } }),
    { ASSETS: assets.binding },
    {},
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'cloudflare_d1_required' });
  assert.deepEqual(assets.calls, []);
});

test('non-API public requests use the Cloudflare Assets binding directly', async () => {
  const assets = assetsSpy(new Response('<h1>public</h1>', { status: 200, headers: { 'content-type': 'text/html' } }));
  const response = await domainWorker.fetch(
    new Request('https://app.test/alguma-pagina'),
    { ASSETS: assets.binding },
    {},
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>public</h1>');
  assert.deepEqual(assets.calls, ['/alguma-pagina']);
});
