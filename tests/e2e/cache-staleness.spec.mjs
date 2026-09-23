import { test, expect } from '@playwright/test';

const CACHE_NAME = 'debora-lactacao-v1.14.2-cache-reset';
const STALE_MARKER = 'STALE_ROOT_MARKER';

async function installServiceWorkerAndSeedStaleRoot(page) {
  await page.goto('/app/');
  await page.waitForFunction(() => 'serviceWorker' in navigator && Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async ({ cacheName, staleMarker }) => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    const cache = await caches.open(cacheName);
    await cache.put('/', new Response(`<!doctype html><body>${staleMarker}</body>`, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    }));
  }, { cacheName: CACHE_NAME, staleMarker: STALE_MARKER });

  const seeded = await page.evaluate(async ({ cacheName }) => {
    const cached = await (await caches.open(cacheName)).match('/');
    return cached?.text();
  }, { cacheName: CACHE_NAME });
  expect(seeded).toContain(STALE_MARKER);
}

for (const pathname of ['/app/', '/comercial/']) {
  test(`${pathname} never falls back to cached root HTML when navigation is offline`, async ({ page, context }) => {
    await installServiceWorkerAndSeedStaleRoot(page);
    await context.setOffline(true);
    let navigationError = null;
    try {
      await page.goto(`${pathname}?cache-probe=${Date.now()}`, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
    } catch (error) {
      navigationError = error;
    } finally {
      await context.setOffline(false);
    }
    expect(navigationError).toBeTruthy();
  });
}
