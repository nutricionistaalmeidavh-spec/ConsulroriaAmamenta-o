import { test,expect } from './fixtures.mjs';
import { login,authHeaders,uniqueLabel } from './helpers.mjs';

test('selecting terms in patient registration never grants consent before maternal signature',async({page})=>{
  await login(page);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(uniqueLabel('Assinatura paciente'));
  await page.locator('[name=motherEmail]').fill('mae-assinatura@example.test');
  await page.locator('[data-baby-field="name"]').first().fill(uniqueLabel('Bebê'));
  await page.locator('[data-signature-select="data_processing"]').check();
  await page.locator('[data-signature-select="whatsapp"]').check();
  await expect(page.locator('[data-signature-selection-summary]')).toContainText('2 documento(s)');
  await expect(page.locator('[data-patient-form] button[type=submit]:visible').first()).toContainText('preparar termos');
  const created=page.waitForResponse(r=>r.url().endsWith('/api/clinical/patients')&&r.request().method()==='POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response=await created;expect(response.status()).toBe(201);
  const patient=await response.json(),motherId=patient.mother.id;
  await expect(page).toHaveURL(new RegExp(motherId));
  const headers=await authHeaders(page);
  const motherRes=await page.request.get('/api/clinical/records/mothers?id=eq.'+motherId+'&limit=1',{headers});
  expect(motherRes.ok()).toBeTruthy();
  const mothers=await motherRes.json();
  expect(mothers[0].email).toBe('mae-assinatura@example.test');
  const consentRes=await page.request.get('/api/clinical/records/consents?mother_id=eq.'+motherId,{headers});
  expect(consentRes.ok()).toBeTruthy();
  const consents=await consentRes.json();
  expect(consents.find(x=>x.consent_type==='data_processing')?.granted).toBe(false);
  expect(consents.find(x=>x.consent_type==='whatsapp')?.granted).toBe(false);
  await expect.poll(async()=>{
    const result=await page.request.get('/api/clinical/signatures/requests?mother_id='+motherId,{headers});
    if(!result.ok())return -1;
    return (await result.json()).requests.filter(x=>['data_processing','whatsapp'].includes(x.consent_type)).length;
  },{timeout:15000}).toBe(2);
  const drafts=await (await page.request.get('/api/clinical/signatures/requests?mother_id='+motherId,{headers})).json();
  expect(drafts.requests.filter(x=>['data_processing','whatsapp'].includes(x.consent_type)).every(x=>x.status==='draft'&&x.document_frozen===false)).toBe(true);
  await page.locator('[data-action="edit-patient"]:visible').first().click();
  await expect(page.locator('[name=motherEmail]')).toHaveValue('mae-assinatura@example.test');
});

test('reviewed maternal request freezes server-generated legal PDF without a premature email',async({page})=>{
  await login(page);
  await page.locator('[data-action="new-patient"]:visible').first().click();
  await page.locator('[name=motherName]').fill(uniqueLabel('Termo a assinar'));
  await page.locator('[name=motherEmail]').fill('mae-termo@example.test');
  await page.locator('[data-baby-field="name"]').first().fill(uniqueLabel('Bebê'));
  await page.locator('[data-signature-select="whatsapp"]').check();
  await page.locator('[data-signature-reviewed]').check();
  const created=page.waitForResponse(r=>r.url().endsWith('/api/clinical/patients')&&r.request().method()==='POST');
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  const response=await created;expect(response.status()).toBe(201);
  const motherId=(await response.json()).mother.id,headers=await authHeaders(page);
  await expect.poll(async()=>{
    const r=await page.request.get('/api/clinical/signatures/requests?mother_id='+motherId,{headers});
    const rows=(await r.json()).requests||[];
    const match=rows.find(x=>x.consent_type==='whatsapp');
    return match?.document_frozen===true&&match?.status==='draft';
  },{timeout:20000}).toBe(true);
  const requests=(await (await page.request.get('/api/clinical/signatures/requests?mother_id='+motherId,{headers})).json()).requests;
  const draft=requests.find(x=>x.consent_type==='whatsapp');
  const pdf=await page.request.get('/api/clinical/signatures/requests/'+draft.id+'/document',{headers});
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0,5).toString()).toBe('%PDF-');
  const consent=await page.request.get('/api/clinical/records/consents?mother_id=eq.'+motherId,{headers});
  const consents=await consent.json();
  expect(consents.find(x=>x.consent_type==='whatsapp')?.granted).toBe(false);
});
