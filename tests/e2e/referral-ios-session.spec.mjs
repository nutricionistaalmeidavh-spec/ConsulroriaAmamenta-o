import {test,expect} from './fixtures.mjs';
import {login,uniqueLabel} from './helpers.mjs';

test('WebKit iPhone: finalize referral, share PDF and return without new login',async({page})=>{
  test.setTimeout(150000);
  await login(page);
  await expect(page.locator('[data-auth-screen="login"]')).toBeHidden();
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name="motherName"]').fill(uniqueLabel('Mãe QA WebKit'));
  await page.locator('[data-baby-field="name"]').first().fill(uniqueLabel('Bebê QA WebKit'));
  await page.locator('[name="consentData"]').check();
  const creating=page.waitForResponse(r=>r.url().endsWith('/api/clinical/patients')&&r.request().method()==='POST');
  await page.locator('[data-patient-form] button[type="submit"]:visible').first().click();
  const created=await creating;
  expect(created.status()).toBe(201);
  const patient=await created.json();
  const motherId=patient.mother.id;
  const sessionBefore=await page.evaluate(()=>window.DeboraRuntimeClient?.getSession()?.user?.id);
  expect(sessionBefore).toBeTruthy();

  await page.evaluate(()=>{
    window.__qaReferralShares=[];
    Object.defineProperty(navigator,'canShare',{configurable:true,value:({files})=>Boolean(files?.length)});
    Object.defineProperty(navigator,'share',{configurable:true,value:async({files})=>{
      window.__qaReferralShares.push(...files.map(file=>({name:file.name,type:file.type})));
    }});
  });
  await expect.poll(()=>page.evaluate(()=>Boolean(window.DeboraReferrals?.openNew))).toBe(true);
  await page.evaluate(id=>window.DeboraReferrals.openNew(id),motherId);
  await page.locator('[data-rf-new] button[type="submit"]').click();
  await expect(page.locator('[data-rf-editor]')).toBeVisible();
  // A placeholder is the professional's choice; it must not block finalization.
  await page.locator('[data-rf-editor]').evaluate(editor=>{
    editor.innerHTML='<p>Prezada equipe,</p><h2>Motivo do encaminhamento</h2><p>[Descreva o motivo do encaminhamento.]</p><p>Atenciosamente,</p>';
    editor.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.locator('[data-rf-finalize]').click();
  await expect(page.locator('[data-rf-ios-pdf-ready]')).toBeVisible();
  await expect(page.locator('[data-rf-ios-pdf-open]')).toBeVisible();
  const saved=await page.evaluate(id=>window.DeboraDocuments.listDocuments(id,'referral'),motherId);
  expect(saved.find(doc=>doc.status==='finalized'&&doc.content?.issued_snapshot?.html?.includes('[Descreva'))).toBeTruthy();
  await expect(page.locator('[data-auth-screen="login"]')).toBeHidden();

  await page.locator('[data-rf-ios-pdf-open]').click();
  await expect.poll(()=>page.evaluate(()=>window.__qaReferralShares.length)).toBe(1);
  const shared=await page.evaluate(()=>window.__qaReferralShares[0]);
  expect(shared.type).toBe('application/pdf');
  expect(shared.name).toMatch(/encaminhamento.*\.pdf/i);
  await expect(page.locator('[data-auth-screen="login"]')).toBeHidden();
  expect(await page.evaluate(()=>window.DeboraRuntimeClient?.getSession()?.user?.id)).toBe(sessionBefore);

  await page.reload();
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await expect(page.locator('[data-auth-screen="login"]')).toBeHidden();
  expect(await page.evaluate(()=>window.DeboraRuntimeClient?.getSession()?.user?.id)).toBe(sessionBefore);
});
