import { test, expect } from '@playwright/test';
import { login, session } from './helpers.mjs';

const CANONICAL = 'debora-lactacao-session';
const ALIASES = ['amamentacao-session', 'commercial.saas.session.v1'];

async function assertTemporaryFailurePreservesSession(page, failure) {
  await login(page);
  const before = await session(page);
  expect(before?.access_token).toBeTruthy();

  await page.route('**/api/clinical/records/**', async route => {
    if (failure === 'offline') return route.abort('internetdisconnected');
    return route.fulfill({
      status: failure,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'temporary synthetic failure' }),
    });
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(250);
  const duringFailure = await page.evaluate(key => localStorage.getItem(key), CANONICAL);
  expect(JSON.parse(duringFailure).access_token).toBe(before.access_token);

  await page.unroute('**/api/clinical/records/**');
  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  expect((await session(page)).access_token).toBe(before.access_token);
}

for (const failure of [503, 429, 'offline']) {
  test(`temporary ${failure} clinical failure preserves the browser session and recovers`, async ({ page }) => {
    await assertTemporaryFailurePreservesSession(page, failure);
  });
}

test('reload keeps the canonical session and does not resurrect a stale commercial alias', async ({ page }) => {
  await login(page);
  const fresh = await session(page);
  const stale = { access_token: 'stale-token', refresh_token: 'stale-refresh' };

  await page.evaluate(({ staleValue }) => {
    sessionStorage.setItem('commercial.saas.session.v1', JSON.stringify(staleValue));
  }, { staleValue: stale });

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();

  const values = await page.evaluate(({ canonical, aliases }) => ({
    canonical: JSON.parse(localStorage.getItem(canonical)),
    aliases: aliases.map(key => {
      const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    }),
  }), { canonical: CANONICAL, aliases: ALIASES });

  expect(values.canonical.access_token).toBe(fresh.access_token);
  for (const alias of values.aliases) {
    expect(alias?.access_token).not.toBe('stale-token');
  }
});
