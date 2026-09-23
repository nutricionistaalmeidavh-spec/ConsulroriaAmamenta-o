import { test, expect } from '@playwright/test';

const OLD_CACHE = 'debora-lactacao-v1.14.1-stability';
const STALE_MARKER = 'STALE_VERSION_N';

test('client on version N upgrades to N+1 and never resurrects stale HTML after reload', async ({ page }) => {
  await page.goto('/app/');
  await page.waitForFunction(() => 'serviceWorker' in navigator);

  await page.evaluate(async ({ oldCache, staleMarker }) => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    for (const key of await caches.keys()) await caches.delete(key);

    const cache = await caches.open(oldCache);
    await cache.put('/', new Response(`<!doctype html><body>${staleMarker}</body>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
    await cache.put('/app/', new Response(`<!doctype html><body>${staleMarker}</body>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
  }, { oldCache: OLD_CACHE, staleMarker: STALE_MARKER });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(Boolean));
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));

  const state = await page.evaluate(async () => ({
    caches: await caches.keys(),
    controller: navigator.serviceWorker.controller?.scriptURL || '',
    html: document.documentElement.outerHTML,
  }));

  expect(state.caches).not.toContain(OLD_CACHE);
  expect(state.controller).toMatch(/\/sw\.js(?:\?|$)/);
  expect(state.html).not.toContain(STALE_MARKER);
});
