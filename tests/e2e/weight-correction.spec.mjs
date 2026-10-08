import { test, expect } from './fixtures.mjs';
import { login, uniqueLabel, authHeaders } from './helpers.mjs';

test('pesagem retroativa, correção e invalidação usam a timeline V5 e um único dado canônico', async ({page})=>{
  await login(page);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(uniqueLabel('Mãe pesagem'));
  await page.locator('[data-baby-field="name"]').first().fill(uniqueLabel('Bebê pesagem'));
  await page.locator('[data-baby-field="birth_date"]').first().fill('2026-08-20');
  await page.locator('[data-baby-field="birth_weight_g"]').first().fill('3300');
  await page.locator('[name=consentData]').check();
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toBeVisible();
  await page.waitForFunction(()=>Boolean(window.DeboraWeightCorrection?.openNew));
  await page.locator('[data-action="add-weight"]:visible').first().click();
  await expect(page.locator('#wc-dialog')).toBeVisible();
  await page.locator('[data-wc-weight]').fill('3850');
  await page.locator('[data-wc-date]').fill('2026-09-10');
  const created=page.waitForResponse(r=>r.url().includes('/api/clinical/rpc/record_growth_measurement')&&r.request().method()==='POST');
  await page.locator('#wc-dialog button[type=submit]').click();
  expect((await created).status()).toBe(200);
  await expect(page.locator('[data-weight-history-v5]')).toContainText('3.850 g');

  await page.locator('[data-weight-history-v5] [data-gf-edit-row]').last().click();
  await expect(page.locator('#wc-dialog')).toBeVisible();
  await expect(page.locator('[data-wc-date]')).toHaveValue('2026-09-10');
  await page.locator('[data-wc-weight]').fill('3900');
  await page.locator('[data-wc-date]').fill('2026-09-11');
  const corrected=page.waitForResponse(r=>r.url().includes('/api/clinical/rpc/revise_weight_measurement'));
  await page.locator('#wc-dialog button[type=submit]').click();
  expect((await corrected).status()).toBe(200);
  await expect(page.locator('[data-weight-history-v5]')).toContainText('3.900 g');
  await expect(page.locator('[data-weight-history-v5]')).not.toContainText('3.850 g');

  await page.locator('[data-weight-history-v5] [data-gf-edit-row]').last().click();
  await page.locator('[data-wc-void-toggle]').click();
  await page.locator('[data-wc-reason]').fill('Pesagem registrada no prontuário errado');
  const voided=page.waitForResponse(r=>r.url().includes('/api/clinical/rpc/revise_weight_measurement'));
  await page.locator('[data-wc-void]').click();
  expect((await voided).status()).toBe(200);
  await expect(page.locator('[data-weight-history-v5]')).not.toContainText('3.900 g');

  const babyId=await page.locator('[data-baby-selector] .baby-tab.active').getAttribute('data-baby-id');
  const records=await page.request.get('/api/clinical/records/weights?baby_id=eq.'+encodeURIComponent(babyId),{headers:await authHeaders(page)});
  const weights=await records.json();
  expect(weights.some(row=>row.voided_at&&Array.isArray(row.correction_history)&&row.correction_history.length>=2)).toBeTruthy();
});
