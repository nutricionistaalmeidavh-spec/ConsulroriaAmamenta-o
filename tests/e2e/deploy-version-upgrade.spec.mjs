import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const RELEASE_N = 'e2e-N';
const RELEASE_N_PLUS_1 = 'e2e-N+1';
const OLD_CACHE = 'debora-lactacao-v1.14.1-stability';
const STALE_MARKER = 'STALE_VERSION_N';
const LEGACY_WORKER = '/legacy-sw-test.js';
const currentServiceWorker = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

test('client on version N upgrades to N+1 and never resurrects stale HTML after reload', async ({ page }) => {
  expect(RELEASE_N).toBe('e2e-N');
  expect(RELEASE_N_PLUS_1).toBe('e2e-N+1');
  expect(currentServiceWorker).toContain("VERSION='1.14.2-cache-reset'");
  expect(currentServiceWorker).not.toContain("cache.match('./')");

  await page.goto('/comercial/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => 'serviceWorker' in navigator);

  await page.evaluate(async ({ oldCache, staleMarker, legacyWorker }) => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    for (const key of await caches.keys()) await caches.delete(key);

    const registration = await navigator.serviceWorker.register(legacyWorker, { scope: '/' });
    await new Promise((resolve, reject) => {
      const worker = registration.installing || registration.waiting || registration.active;
      if (registration.active) return resolve();
      if (!worker) return reject(new Error('legacy worker was not created'));
      const timeout = setTimeout(() => reject(new Error('legacy worker activation timeout')), 10000);
      worker.addEventListener('statechange', () => {
        if (worker.state === 'activated') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    const cache = await caches.open(oldCache);
    await cache.put('/', new Response(`<!doctype html><body>${staleMarker}</body>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    await cache.put('/app/', new Response(`<!doctype html><body>${staleMarker}</body>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
  }, { oldCache: OLD_CACHE, staleMarker: STALE_MARKER, legacyWorker: LEGACY_WORKER });

  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes('/legacy-sw-test.js'));

  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return registrations.some((registration) => [registration.installing, registration.waiting, registration.active]
      .some((worker) => worker?.scriptURL.includes('/sw.js')));
  }, { timeout: 20000 });

  const controllerchange = page.evaluate(() => new Promise((resolve, reject) => {
    const currentController = () => navigator.serviceWorker.controller?.scriptURL || '';
    if (currentController().includes('/sw.js')) {
      resolve(currentController());
      return;
    }

    const timeout = setTimeout(() => reject(new Error('controllerchange timeout')), 20000);
    const onControllerChange = () => {
      const scriptUrl = currentController();
      if (!scriptUrl.includes('/sw.js')) return;
      clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      resolve(scriptUrl);
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
  }));

  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const registration = registrations.find((item) => [item.installing, item.waiting, item.active]
      .some((worker) => worker?.scriptURL.includes('/sw.js')));
    if (!registration) throw new Error('current service worker registration missing');
    await registration.update();
  });

  await controllerchange;
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes('/sw.js'));

  const state = await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    return {
      caches: await caches.keys(),
      controller: navigator.serviceWorker.controller?.scriptURL || '',
      registrations: registrations.flatMap((registration) => [registration.installing, registration.waiting, registration.active]
        .map((worker) => worker?.scriptURL)
        .filter(Boolean)),
      html: document.documentElement.outerHTML,
    };
  });

  expect(state.caches).not.toContain(OLD_CACHE);
  expect(state.controller).toMatch(/\/sw\.js(?:\?|$)/);
  expect(state.registrations.some((url) => url.includes(LEGACY_WORKER))).toBe(false);
  expect(state.html).not.toContain(STALE_MARKER);
});
