import { test, expect } from './fixtures.mjs';
import { login, session, uniqueLabel } from './helpers.mjs';

// Playwright page.route() does not reliably intercept requests once a Service Worker
// controls the page. P0 network-failure tests therefore disable SW only in this file;
// the rest of the E2E suite keeps normal PWA behavior enabled.
test.use({ serviceWorkers: 'block' });

async function openSyntheticPatientForm(page, prefix) {
  const motherName = uniqueLabel(`${prefix} mother`);
  const babyName = uniqueLabel(`${prefix} baby`);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(motherName);
  await page.locator('[data-baby-field=name]').first().fill(babyName);
  await page.locator('[name=consentData]').check();
  return { motherName, babyName };
}

for (const status of [503, 429]) {
  test(`patient save survives a temporary ${status} and retries with the same idempotency key`, async ({ page }) => {
    await login(page);
    const before = await session(page);
    const { motherName, babyName } = await openSyntheticPatientForm(page, `HTTP ${status}`);
    const keys = [];
    let failOnce = true;

    await page.route('**/api/clinical/patients', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      keys.push(route.request().headers()['idempotency-key']);
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          status,
          contentType: 'application/json',
          body: JSON.stringify({ message: `temporary ${status} synthetic failure` }),
        });
      }
      return route.continue();
    });

    await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
    await expect(page.locator('[data-patient-form-status]')).toContainText(`temporary ${status}`);
    expect((await session(page)).access_token).toBe(before.access_token);
    expect(keys).toHaveLength(1);

    await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
    await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
    await expect(page).toHaveURL(/#\/patient\/(?!form)[^/]+/);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });
}

test('offline patient save keeps the session and succeeds after connectivity returns', async ({ page, context }) => {
  await login(page);
  const before = await session(page);
  const { motherName, babyName } = await openSyntheticPatientForm(page, 'Offline');

  await context.setOffline(true);
  try {
    await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
    await expect(page.locator('[data-patient-form-status]')).not.toBeEmpty();
    expect((await session(page)).access_token).toBe(before.access_token);
  } finally {
    await context.setOffline(false);
  }

  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toHaveText(`${motherName} + ${babyName}`);
  await expect(page).toHaveURL(/#\/patient\/(?!form)[^/]+/);
  expect((await session(page)).access_token).toBe(before.access_token);
});
