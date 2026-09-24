import { test, expect } from '@playwright/test';

const CACHE_NAME = 'debora-lactacao-v1.14.2-cache-reset';
const STALE_MARKER = 'STALE_ROOT_MARKER';
const OFFLINE_PATHS = ['/app/', '/comercial/'];

test.use({ serviceWorkers: 'allow' });

async function installServiceWorkerAndSeedStaleRoot(page) {
  await page.goto('/app/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        const timeout = setTimeout(resolve, 3000);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
      });
    }
  });
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
  }
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await page.evaluate(async ({ cacheName, staleMarker }) => {
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

test('app and commercial navigation never fall back to cached root HTML when offline', async ({ page, context }) => {
  await installServiceWorkerAndSeedStaleRoot(page);

  for (const pathname of OFFLINE_PATHS) {
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
    expect(navigationError, `${pathname} must fail instead of rendering cached root HTML`).toBeTruthy();
  }
});
