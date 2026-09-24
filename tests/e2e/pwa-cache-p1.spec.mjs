import { test, expect } from './fixtures.mjs';
import { login, session } from './helpers.mjs';

test.use({ serviceWorkers: 'allow' });

test('service worker evicts obsolete app caches, never caches private APIs and preserves session on reload', async ({ page, context }) => {
  await page.goto('/manifest.webmanifest');
  await page.evaluate(async () => {
    const stale = await caches.open('debora-lactacao-v0-p1-obsolete');
    await stale.put('/obsolete-p1.js', new Response('obsolete'));
  });

  await login(page);
  const before = await session(page);
  expect(before?.access_token).toBeTruthy();

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
  });
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    return keys.some(key => key.startsWith('debora-lactacao-v')) && !keys.includes('debora-lactacao-v0-p1-obsolete');
  });

  const apiStatus = await page.evaluate(async token => {
    const response = await fetch('/api/clinical/records/mothers?select=id&limit=1', {
      headers: { authorization: `Bearer ${token}` },
    });
    return response.status;
  }, before.access_token);
  expect(apiStatus).toBe(200);

  const cachedPrivateUrls = await page.evaluate(async () => {
    const urls = [];
    for (const key of await caches.keys()) {
      if (!key.startsWith('debora-lactacao-v')) continue;
      const cache = await caches.open(key);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/clinical-source/')) urls.push(url.pathname);
      }
    }
    return urls;
  });
  expect(cachedPrivateUrls).toEqual([]);

  const cacheNames = await page.evaluate(() => caches.keys());
  expect(cacheNames.filter(key => key.startsWith('debora-lactacao-v'))).toHaveLength(1);

  // The service-worker update may replace the controller and reload the page that
  // initiated it. Verify persistence from a fresh page in the same browser context,
  // then perform an explicit document reload under the settled current controller.
  const verifyPage = await context.newPage();
  await verifyPage.goto('/app/#/home', { waitUntil: 'domcontentloaded' });
  await expect(verifyPage.locator('[data-app-root]')).toBeVisible();
  await verifyPage.reload({ waitUntil: 'domcontentloaded' });
  await expect(verifyPage.locator('[data-app-root]')).toBeVisible();
  const after = await session(verifyPage);
  expect(after.access_token).toBe(before.access_token);
});
