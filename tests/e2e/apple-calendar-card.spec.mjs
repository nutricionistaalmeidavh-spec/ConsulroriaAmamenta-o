import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const script = readFileSync(new URL('../../public/apple-calendar-feature.js', import.meta.url), 'utf8');
const subscriptionUrl = 'https://deboralactacao.com/api/calendar/apple/feed/' + 'a'.repeat(64) + '.ics';

async function mountAppleCard(page, api) {
  await page.route('**/api/calendar/apple/**', route => api(route));
  await page.goto('/comercial/', { waitUntil: 'domcontentloaded' });
  await page.setContent('<main data-screen="settings"><div class="settings-list"></div></main>');
  await page.evaluate(() => {
    localStorage.setItem('amamentacao-session', JSON.stringify({ access_token: 'apple-ui-test' }));
    history.replaceState(null, '', '#/settings');
  });
  await page.addScriptTag({ content: script });
}

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function answerConfirmation(page, click, accept) {
  // Wait for the asynchronous status lookup before resolving its confirmation.
  // Do not let a second listener consume the previous operation's dialog.
  await Promise.all([
    page.waitForEvent('dialog').then(dialog => accept ? dialog.accept() : dialog.dismiss()),
    click(),
  ]);
}

test('active Apple link is a compact state with advanced actions collapsed', async ({ page }) => {
  await mountAppleCard(page, route => json(route, { active: true }));
  const card = page.locator('[data-apple-calendar-integration]');
  await expect(card.locator('[data-apple-state]')).toHaveText('Link ativo');
  await expect(card.locator('[data-apple-create]')).toBeHidden();
  await expect(card.locator('[data-apple-subscription]')).toBeHidden();
  await expect(card.locator('[data-apple-manage-panel]')).toBeHidden();
  await card.locator('[data-apple-manage]').click();
  await expect(card.locator('[data-apple-manage]')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('[data-apple-rotate]')).toBeVisible();
  await expect(card.locator('[data-apple-revoke]')).toBeVisible();
  await expect(card.locator('[data-apple-privacy]')).toBeVisible();
  await card.locator('[data-apple-manage]').click();
  await expect(card.locator('[data-apple-manage-panel]')).toBeHidden();
});

test('rotating a link needs confirmation and revoking clears the generated link', async ({ page }) => {
  let active = true;
  const methods = [];
  await mountAppleCard(page, route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    methods.push(method + ' ' + path);
    if (path.endsWith('/status')) return json(route, { active });
    if (path.endsWith('/create') && method === 'POST') {
      active = true;
      return json(route, { active: true, subscription_url: subscriptionUrl,
        webcal_url: subscriptionUrl.replace('https:', 'webcal:') });
    }
    if (path.endsWith('/revoke') && method === 'POST') {
      active = false;
      return json(route, { active: false, revoked: true });
    }
    return json(route, { error: 'unhandled' }, 404);
  });
  const card = page.locator('[data-apple-calendar-integration]');
  await expect(card.locator('[data-apple-state]')).toHaveText('Link ativo');
  await card.locator('[data-apple-manage]').click();
  await answerConfirmation(page, () => card.locator('[data-apple-rotate]').click(), false);
  await expect(card.locator('[data-apple-rotate]')).toBeEnabled();
  await expect(card.locator('[data-apple-subscription]')).toBeHidden();
  expect(methods.some(method => method.startsWith('POST '))).toBe(false);

  await answerConfirmation(page, () => card.locator('[data-apple-rotate]').click(), true);
  await expect(card.locator('[data-apple-subscription]')).toBeVisible();
  await expect(card.locator('[data-apple-open]')).toHaveAttribute('href', subscriptionUrl.replace('https:', 'webcal:'));
  await expect(card.locator('[data-apple-state]')).toHaveText('Link ativo');

  await card.locator('[data-apple-manage]').click();
  await answerConfirmation(page, () => card.locator('[data-apple-revoke]').click(), true);
  await expect(card.locator('[data-apple-state]')).toHaveText('Não conectado');
  await expect(card.locator('[data-apple-subscription]')).toBeHidden();
  await expect(card.locator('[data-apple-create]')).toBeVisible();
  expect(methods.filter(method => method.includes('POST /api/calendar/apple/revoke'))).toHaveLength(1);
});

test('a failed status check blocks risky actions and offers a retry', async ({ page }) => {
  let unavailable = true;
  await mountAppleCard(page, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/status')) {
      return unavailable ? json(route, { error: 'temporarily_unavailable' }, 503) :
        json(route, { active: false });
    }
    return json(route, { error: 'unexpected_mutation' }, 500);
  });
  const card = page.locator('[data-apple-calendar-integration]');
  await expect(card.locator('[data-apple-state]')).toHaveText('Não foi possível verificar');
  await expect(card.locator('[data-apple-create]')).toBeHidden();
  await expect(card.locator('[data-apple-manage]')).toBeHidden();
  unavailable = false;
  await card.locator('[data-apple-retry]').click();
  await expect(card.locator('[data-apple-state]')).toHaveText('Não conectado');
  await expect(card.locator('[data-apple-create]')).toBeVisible();
});
