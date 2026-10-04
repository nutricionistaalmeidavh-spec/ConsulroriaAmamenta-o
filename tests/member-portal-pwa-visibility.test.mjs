import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMBER_PORTAL_FRONTEND_ENABLED,
  isMemberPortalHash,
  shouldOpenMemberPortal,
  normalizeDisabledMemberPortalLocation,
} from '../src/member-portal-policy.js';
import { ensureCanonicalServiceWorker } from '../src/pwa-service-worker.js';

test('mother portal frontend stays disabled and stale #mae hashes are normalized', () => {
  assert.equal(MEMBER_PORTAL_FRONTEND_ENABLED, false);
  assert.equal(isMemberPortalHash('#mae'), true);
  assert.equal(isMemberPortalHash('#mae/conteudos'), true);
  assert.equal(shouldOpenMemberPortal('#mae'), false);

  const calls = [];
  const locationLike = { pathname: '/app/', search: '?from=pwa', hash: '#mae' };
  const historyLike = {
    state: { keep: true },
    replaceState(state, title, url) { calls.push({ state, title, url }); },
  };

  assert.equal(normalizeDisabledMemberPortalLocation(locationLike, historyLike), true);
  assert.deepEqual(calls, [{ state: { keep: true }, title: '', url: '/app/?from=pwa' }]);
});

test('non-member hashes are not rewritten', () => {
  const calls = [];
  const locationLike = { pathname: '/app/', search: '', hash: '#pacientes' };
  const historyLike = { state: null, replaceState(...args) { calls.push(args); } };
  assert.equal(normalizeDisabledMemberPortalLocation(locationLike, historyLike), false);
  assert.deepEqual(calls, []);
});

test('canonical service worker registration starts immediately without waiting for window load', async () => {
  const calls = [];
  const registration = {
    async update() { calls.push(['update']); },
  };
  const serviceWorker = {
    async register(url, options) {
      calls.push(['register', url, options]);
      return registration;
    },
  };

  const result = await ensureCanonicalServiceWorker(serviceWorker, { warn() {} });
  assert.equal(result, registration);
  assert.deepEqual(calls, [
    ['register', '/sw.js', { scope: '/', updateViaCache: 'none' }],
    ['update'],
  ]);
});

test('service worker registration degrades safely when unavailable', async () => {
  assert.equal(await ensureCanonicalServiceWorker(null, { warn() {} }), null);
});
