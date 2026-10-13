import { test, expect } from './fixtures.mjs';
import { login, authHeaders, uniqueLabel } from './helpers.mjs';

test('Financeiro card excludes pending entry, preserves D1 history and blocks paid exclusion',async({page})=>{
  await login(page);
  const headers={...(await authHeaders(page)),'content-type':'application/json'};
  const pendingLabel=uniqueLabel('Finance remove');
  const paidLabel=uniqueLabel('Finance paid');
  const create=async(description,status)=> {
    const response=await page.request.post('/api/clinical/records/financial_entries',{
      headers,data:{ description, amount_cents:60000,status,paid:status==='Pago',payment_method:status==='Pago'?'Pix':'',
        ...(status==='Pago'?{paid_at:new Date().toISOString()}:{}) }
    });
    expect(response.ok()).toBeTruthy();
    return (await response.json())[0];
  };
  const pending=await create(pendingLabel,'Pendente');
  const paid=await create(paidLabel,'Pago');
  // The canonical finance projection is loaded at app startup, not on navigation.
  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-nav-target=finance]:visible').first().click();
  const pendingCard=page.locator('.finance-card').filter({hasText:pendingLabel});
  const paidCard=page.locator('.finance-card').filter({hasText:paidLabel});
  await expect(pendingCard).toBeVisible();
  await expect(paidCard).toBeVisible();
  const paidCancel=paidCard.locator('[data-action=cancel-finance]');
  await paidCancel.click();
  await expect(paidCard).toBeVisible();
  page.once('dialog',dialog=>{expect(dialog.type()).toBe('confirm');dialog.accept();});
  await pendingCard.locator('[data-action=cancel-finance]').click();
  await expect(pendingCard).toHaveCount(0);
  const get=async id=>{
    const response=await page.request.get(`/api/clinical/records/financial_entries?id=eq.${encodeURIComponent(id)}&limit=1`,{headers});
    expect(response.ok()).toBeTruthy();return (await response.json())[0];
  };
  expect((await get(pending.id)).status).toBe('Cancelado');
  expect((await get(paid.id)).status).toBe('Pago');
  await page.reload();
  await page.locator('[data-nav-target=finance]:visible').first().click();
  await expect(page.locator('[data-finance-live]')).not.toContainText(pendingLabel);
  await expect(page.locator('[data-finance-live]')).toContainText(paidLabel);
});
