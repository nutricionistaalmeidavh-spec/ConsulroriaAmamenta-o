import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('clinical requests keep their method, token and body on the Cloudflare origin', async () => {
  const calls = [];
  const window = { location: { origin: 'https://app.example.test' }, fetch: async (...args) => { calls.push(args); return new Response('{}'); } };
  const storage = { getItem: () => null, setItem() {} };
  const source = readFileSync(new URL('../src/cloudflare-fetch-bridge.js', import.meta.url), 'utf8').replace(/^export .*$/m, '');
  runInNewContext(source, { window, localStorage: storage, sessionStorage: storage, URL, Request });
  const legacy = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
  for (const path of ['/auth/v1/token?grant_type=password', '/rest/v1/babies', '/storage/v1/object/clinical-media/test']) {
    await window.fetch(new Request(legacy + path, { method: 'POST', headers: { authorization: 'Bearer test-cloudflare-token' }, body: '{"test":true}' }));
    const request = calls.at(-1)[0];
    assert.equal(request.url, window.location.origin + path);
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.get('authorization'), 'Bearer test-cloudflare-token');
    assert.equal(await request.text(), '{"test":true}');
  }
  await window.fetch('https://unrelated.example.test/rest/v1/babies');
  assert.equal(calls.at(-1)[0], 'https://unrelated.example.test/rest/v1/babies');
});

test('every clinical entry installs the bridge before starting the application', () => {
  for (const path of ['../index.html', '../app/index.html']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    const bridge = source.indexOf('/src/cloudflare-fetch-bridge.js');
    assert.ok(bridge >= 0 && bridge < source.indexOf('/src/bootstrap.js'), path);
  }
  const bootstrap = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /import '\.\/cloudflare-fetch-bridge\.js'/);
});
