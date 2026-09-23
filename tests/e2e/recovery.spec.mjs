import {test,expect} from './fixtures.mjs';
import {credentials} from '../helpers/cloudflare-local.mjs';

async function recoveryToken(request, email) {
  expect((await request.post('/api/auth/recovery',{data:{email}})).status()).toBe(202);
  const inbox=await (await request.get('http://127.0.0.1:4174/recovery-inbox')).json();
  const message=[...inbox].reverse().find(m=>m.to===email);
  expect(message?.recoveryUrl).toBeTruthy();
  return new URL(message.recoveryUrl).hash.slice('#recovery_token='.length);
}

test('commercial recovery resets the D1 password with a backend-generated link',async({page,request})=>{
  const email='recovery-e2e@example.test';
  expect((await request.post('/api/auth/signup',{data:{email,password:credentials.password}})).ok()).toBeTruthy();
  await page.goto('/comercial/index.html');
  await page.getByRole('button',{name:'Entrar',exact:true}).first().click();
  await page.locator('#login-form [name=email]').fill(email);
  await page.locator('[data-recover-password]').click();
  await expect(page.locator('#form-message')).toContainText('Solicitação processada');
  const inbox=await (await request.get('http://127.0.0.1:4174/recovery-inbox')).json();
  const link=new URL(inbox.find(m=>m.to===email).recoveryUrl);
  await page.goto(link.pathname+link.search+link.hash);
  await expect(page.locator('#reset-password-form')).toBeVisible();
  expect(page.url()).not.toContain('recovery_token');
  await page.locator('#reset-password-form [name=password]').fill('New-local-password-2026!');
  await page.locator('#reset-password-form [name=confirmPassword]').fill('New-local-password-2026!');
  await page.locator('#reset-password-form button').click();
  await expect(page.locator('#login-form')).toBeVisible();
  await page.locator('#login-form [name=email]').fill(email);
  await page.locator('#login-form [name=password]').fill('New-local-password-2026!');
  const loggedIn=page.waitForResponse(r=>r.url().includes('grant_type=password'));
  await page.locator('#login-form button[type=submit]').click();
  expect((await loggedIn).status()).toBe(200);
  expect((await request.post('/api/auth/token?grant_type=password',{data:{email,password:credentials.password}})).status()).toBe(400);
  expect((await request.post('/api/auth/reset-password',{data:{token:link.hash.slice('#recovery_token='.length),password:'another-password'}})).status()).toBe(400);
});

test('expired recovery token is rejected without changing the password',async({request})=>{
  const email=`expired-${Date.now()}@example.test`;
  expect((await request.post('/api/auth/signup',{data:{email,password:credentials.password}})).ok()).toBeTruthy();
  const token=await recoveryToken(request,email);
  const expired=await request.post('http://127.0.0.1:4174/control/expire-recovery',{data:{email}});
  expect(expired.ok()).toBeTruthy();
  expect((await request.post('/api/auth/reset-password',{data:{token,password:'Expired-token-password-2026!'}})).status()).toBe(400);
  expect((await request.post('/api/auth/token?grant_type=password',{data:{email,password:credentials.password}})).status()).toBe(200);
});

test('late reset failure rolls back token, password and refresh-session changes and permits retry',async({request})=>{
  const email=`rollback-${Date.now()}@example.test`;
  expect((await request.post('/api/auth/signup',{data:{email,password:credentials.password}})).ok()).toBeTruthy();
  const login=await request.post('/api/auth/token?grant_type=password',{data:{email,password:credentials.password}});
  expect(login.ok()).toBeTruthy();
  const oldSession=await login.json();
  const token=await recoveryToken(request,email);

  expect((await request.post('http://127.0.0.1:4174/control/fail-recovery-persist',{data:{enabled:true}})).ok()).toBeTruthy();
  try {
    expect((await request.post('/api/auth/reset-password',{data:{token,password:'Rollback-password-2026!'}})).status()).toBe(503);
  } finally {
    expect((await request.post('http://127.0.0.1:4174/control/fail-recovery-persist',{data:{enabled:false}})).ok()).toBeTruthy();
  }

  expect((await request.post('/api/auth/token?grant_type=password',{data:{email,password:credentials.password}})).status()).toBe(200);
  expect((await request.post('/api/auth/token?grant_type=refresh_token',{data:{refresh_token:oldSession.refresh_token}})).status()).toBe(200);

  expect((await request.post('/api/auth/reset-password',{data:{token,password:'Rollback-password-2026!'}})).status()).toBe(200);
  expect((await request.post('/api/auth/reset-password',{data:{token,password:'Should-not-work'}})).status()).toBe(400);
  expect((await request.post('/api/auth/token?grant_type=password',{data:{email,password:credentials.password}})).status()).toBe(400);
  expect((await request.post('/api/auth/token?grant_type=password',{data:{email,password:'Rollback-password-2026!'}})).status()).toBe(200);
  expect((await request.post('/api/auth/token?grant_type=refresh_token',{data:{refresh_token:oldSession.refresh_token}})).status()).toBe(400);
});

test('two concurrent resets accept exactly one password',async({request})=>{
  const email=`concurrent-${Date.now()}@example.test`;
  expect((await request.post('/api/auth/signup',{data:{email,password:credentials.password}})).ok()).toBeTruthy();
  const token=await recoveryToken(request,email);
  const passwords=['Concurrent-A-2026!','Concurrent-B-2026!'];
  const attempts=await Promise.all(passwords.map(password=>request.post('/api/auth/reset-password',{data:{token,password}})));
  expect(attempts.map(r=>r.status()).sort((a,b)=>a-b)).toEqual([200,400]);
  const logins=await Promise.all(passwords.map(password=>request.post('/api/auth/token?grant_type=password',{data:{email,password}})));
  expect(logins.map(r=>r.status()).sort((a,b)=>a-b)).toEqual([200,400]);
});
