import { test, expect } from './fixtures.mjs';
import { login } from './helpers.mjs';

test('weight curve mounts on patient detail', async ({page}) => {
  await login(page);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill('Growth mother');
  await page.locator('[data-baby-field="name"]').first().fill('Growth baby');
  await page.locator('[name=consentData]').check();
  const created=page.waitForResponse(r=>r.url().endsWith('/api/clinical/patients')&&r.request().method()==='POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  expect((await created).status()).toBe(201);
  // Other UI modules may mutate the DOM while patient data is loading.
  await page.evaluate(()=>{
    const marker=document.createElement('span');document.body.appendChild(marker);
    window.growthTestTicker=setInterval(()=>{marker.textContent=String(Date.now())},50);
  });
  try {
    await expect(page.locator('[data-growth-inline-v3]')).toBeVisible({timeout:15000});
    await expect(page.locator('[data-growth-inline-v3]')).toHaveCount(1);
  } finally { await page.evaluate(()=>clearInterval(window.growthTestTicker)); }
});
