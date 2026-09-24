import { credentials } from '../helpers/cloudflare-local.mjs';

export async function login(page, email = credentials.email, password = credentials.password) {
  await page.goto('/app/');
  await page.locator('[data-login-form] [name=email]').fill(email);
  await page.locator('[data-login-form] [name=password]').fill(password);
  await page.locator('[data-login-form] button[type=submit]').click();
  await page.locator('[data-app-root]').waitFor({ state: 'visible' });
}

export async function session(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('debora-lactacao-session')));
}

export async function authHeaders(page) {
  const value = await session(page);
  if (!value?.access_token) throw new Error('Authenticated session not found');
  return { authorization: `Bearer ${value.access_token}` };
}

export function uniqueLabel(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
