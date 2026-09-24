import {test,expect} from './fixtures.mjs';
import {credentials} from '../helpers/cloudflare-local.mjs';

async function login(page) {
  await page.goto('/app/');
  await page.locator('[data-login-form] [name=email]').fill(credentials.email);
  await page.locator('[data-login-form] [name=password]').fill(credentials.password);
  await page.locator('[data-login-form] button[type=submit]').click();
}

test('slow initial data does not expose a form that will later be cleared',async({page})=>{
  let release, entered;
  const gate=new Promise(r=>release=r), pending=new Promise(r=>entered=r);
  await page.route('**/api/clinical/records/**',async route=>{entered();await gate;await route.continue();});
  await login(page);
  await pending;
  try { await expect(page.locator('[data-app-root]')).toBeHidden(); }
  finally { release(); }
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-action=new-patient]:visible').first().click();
  await page.locator('[name=motherName]').fill('Preserved draft');
  await expect(page.locator('[name=motherName]')).toHaveValue('Preserved draft');
});

test('double submit and lost create response reuse one key and create one patient',async({page})=>{
  await login(page);
  await expect(page.locator('[data-app-root]')).toBeVisible();
  await page.locator('[data-action=new-patient]:visible').first().click();
  await page.locator('[name=motherName]').fill('Retry synthetic patient');
  await page.locator('[data-baby-field=name]').fill('Retry synthetic baby');
  await page.locator('[name=consentData]').check();
  const attempts=[];
  let savedId;
  await page.route('**/api/clinical/patients',async route=>{
    attempts.push(route.request().headers()['idempotency-key']);
    const response=await route.fetch();
    expect(response.status()).toBe(201);
    if(attempts.length===1){savedId=(await response.json()).mother.id;await route.abort('failed');}
    else await route.fulfill({response});
  });
  await page.locator('[data-patient-form]').evaluate(form=>{
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  });
  await expect(page.locator('[data-patient-form-status]')).not.toBeEmpty();
  expect(attempts.length).toBe(1);
  await page.locator('[data-patient-form] button[type=submit]:visible').first().click();
  await expect(page.locator('[data-patient-title]')).toHaveText('Retry synthetic patient + Retry synthetic baby');
  expect(attempts.length).toBe(2);
  expect(attempts[0]).toBeTruthy();expect(attempts[1]).toBe(attempts[0]);
  await expect(page).toHaveURL(new RegExp(savedId));
  const session=await page.evaluate(()=>JSON.parse(localStorage.getItem('debora-lactacao-session')));
  const rows=await (await page.request.get('/api/clinical/records/mothers?name=eq.Retry%20synthetic%20patient',{headers:{authorization:`Bearer ${session.access_token}`}})).json();
  expect(rows.length).toBe(1);
});
