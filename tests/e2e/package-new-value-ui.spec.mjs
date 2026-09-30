import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const clinicalCss = readFileSync(new URL('../../public/clinical-source/styles.css', import.meta.url), 'utf8');
const billingCss = readFileSync(new URL('../../public/billing-v2.css', import.meta.url), 'utf8');
const phase8Css = readFileSync(new URL('../../public/phase8-design.css', import.meta.url), 'utf8');
const integrityCss = readFileSync(new URL('../../public/mobile-layout-integrity.css', import.meta.url), 'utf8');

async function mountFixture(page) {
  await page.setContent(`
    <style>${clinicalCss}\n${billingCss}\n${phase8Css}\n${integrityCss}</style>
    <section class="appointment-screen" style="width:min(850px,100%);margin:auto">
      <div class="appointment-meta-grid form-grid">
        <label class="field" data-test-legacy-value>
          <span>Valor total do plano</span>
          <div class="unit-input"><b>R$</b><input data-encounter-field="value" value="0.00"></div>
        </label>
      </div>
      <section class="bv-card">
        <label class="field"><span>Tipo de cobrança</span>
          <select data-bv-mode>
            <option value="individual">Atendimento individual</option>
            <option value="package_new">Novo plano / pacote</option>
          </select>
        </label>
        <div class="bv-new" data-bv-new>
          <div class="bv-grid two">
            <label class="field"><span>Valor total do plano</span><div class="unit-input"><b>R$</b><input data-bv-total type="number"></div></label>
            <label class="field"><span>Quantidade de sessões</span><input data-bv-sessions type="number"></label>
          </div>
        </div>
      </section>
    </section>
  `);
}

test('novo plano mostra um único campo de valor editável e com largura útil', async ({ page }) => {
  await mountFixture(page);
  const mode = page.locator('[data-bv-mode]');
  const legacy = page.locator('[data-test-legacy-value]');
  await mode.selectOption('package_new');

  await expect(legacy).toBeHidden();
  await expect(page.locator('label.field:visible').filter({ hasText: 'Valor total do plano' })).toHaveCount(1);
  const total = page.locator('[data-bv-total]');
  await expect(total).toBeVisible();
  await total.fill('600');
  await expect(total).toHaveValue('600');

  const box = await total.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(120);

  await mode.selectOption('individual');
  await expect(legacy).toBeVisible();
  await mode.selectOption('package_new');
  await expect(legacy).toBeHidden();
  await expect(total).toHaveValue('600');
});

test('layout do valor do novo plano permanece legível em viewport estreita', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mountFixture(page);
  await page.locator('[data-bv-mode]').selectOption('package_new');

  const total = page.locator('[data-bv-total]');
  const totalBox = await total.boundingBox();
  const screenBox = await page.locator('.appointment-screen').boundingBox();
  expect(totalBox).not.toBeNull();
  expect(screenBox).not.toBeNull();
  expect(totalBox.width).toBeGreaterThanOrEqual(120);
  expect(totalBox.x + totalBox.width).toBeLessThanOrEqual(screenBox.x + screenBox.width + 1);
  await expect(page.locator('[data-test-legacy-value]')).toBeHidden();
});
