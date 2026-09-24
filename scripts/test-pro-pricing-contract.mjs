import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const uiFiles = [
  'public/comercial/index.html',
  'public/comercial/plano.html',
  'public/comercial/landing.js',
  'public/comercial/mobile-sales-v2.js',
  'public/comercial/sandbox-teste.html',
];

for (const path of uiFiles) {
  const source = read(path);
  assert.match(source, /R\$ 99,90/, `${path} must expose the current monthly price`);
  assert.match(source, /R\$ 999,90/, `${path} must expose the current annual price`);
  assert.doesNotMatch(source, /R\$ 79,90/, `${path} still contains the former monthly price`);
  assert.doesNotMatch(source, /R\$ 799,90/, `${path} still contains the former annual price`);
}

for (const path of ['cloudflare/billing-schema.sql', 'cloudflare/runtime-schema.sql']) {
  const sql = read(path);
  assert.match(sql, /\('pro_monthly','Plano Pro mensal','month',9990,'BRL',1,1\)/, `${path} monthly D1 seed must be 9990 cents`);
  assert.match(sql, /\('pro_annual','Plano Pro anual','year',99990,'BRL',12,1\)/, `${path} annual D1 seed must be 99990 cents`);
  assert.doesNotMatch(sql, /\('pro_monthly','Plano Pro mensal','month',7990,'BRL',1,1\)/, `${path} still contains the former monthly D1 seed`);
  assert.doesNotMatch(sql, /\('pro_annual','Plano Pro anual','year',79990,'BRL',12,1\)/, `${path} still contains the former annual D1 seed`);
}

const legacySql = read('supabase/phase-saas-billing.sql');
assert.match(legacySql, /'pro_monthly', 'Pro mensal', 'monthly', 9990, 'BRL'/);
assert.match(legacySql, /'pro_annual', 'Pro anual', 'annual', 99990, 'BRL'/);
assert.doesNotMatch(legacySql, /'pro_monthly', 'Pro mensal', 'monthly', 4990, 'BRL'/);
assert.doesNotMatch(legacySql, /'pro_annual', 'Pro anual', 'annual', 49900, 'BRL'/);

const legacyWorker = read('worker/index.js');
assert.match(legacyWorker, /defaultPriceCents = planCode === 'pro_monthly' \? 9990 : 99990/);
assert.doesNotMatch(legacyWorker, /defaultPriceCents = planCode === 'pro_monthly' \? 4990 : 49900/);

const seo = read('worker/commercial-seo.js');
assert.match(seo, /name: 'Pro mensal', price: '99\.90'/);
assert.match(seo, /name: 'Pro anual', price: '999\.90'/);
assert.doesNotMatch(seo, /name: 'Pro mensal', price: '79\.90'/);
assert.doesNotMatch(seo, /name: 'Pro anual', price: '799\.90'/);

const logoGradient = 'linear-gradient(45deg, #a99bcf 0%, #c4a3d4 48%, #f3bfd1 100%)';
const baseCss = read('public/comercial/styles.css');
const lightCss = read('public/comercial/commercial-light-theme.css');
assert.ok(baseCss.includes(logoGradient), 'legacy filled buttons must use the official logo gradient');
assert.ok(lightCss.includes(logoGradient), 'Sales V2 filled buttons must use the official logo gradient');
assert.doesNotMatch(lightCss, /\.sales-v2 \.sales-button\s*\{[^}]*background:\s*#6b3f50/is, 'Sales V2 button block still uses the old brown fill');

console.log('Pro pricing contract: UI, SEO, D1, fallback and official logo button gradient OK');
