import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const js = read('public/comercial/mobile-sales-v2.js');
const css = read('public/comercial/mobile-sales-v2.css');
const brandCss = read('public/comercial/brand-mark.css');
const lightCss = read('public/comercial/commercial-light-theme.css');
const contrastFixCss = read('public/comercial/commercial-sales-v2-contrast-fix.css');
const assetFix = read('public/comercial/mobile-assets-fix.js');
const logo = read('public/icon.svg');
const seo = read('worker/commercial-seo.js');

function assertSelectorColor(cssText, selector, color, message) {
  const normalizedCss = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...normalizedCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const matches = rules.filter(([, selectorList]) =>
    selectorList
      .split(',')
      .map((item) => item.trim())
      .includes(selector),
  );

  assert.ok(matches.length > 0, `${message}: selector ${selector} not found`);
  assert.ok(
    matches.some(([, , declarations]) => new RegExp(`color\\s*:\\s*${color.replace('#', '\\#')}`, 'i').test(declarations)),
    `${message}: ${selector} must use ${color}`,
  );
}

assert.match(js, /Sistema para consultoras de amamentação/i, 'hero must state commercial search intent');
assert.ok((js.match(/data-purchase-card/g) || []).length >= 4, 'landing must contain multiple purchase cards');
assert.match(js, /dashboard\.webp/);
assert.match(css, /real-screens-sprite-small\.webp/);
assert.match(js, /data-plan="freemium"/);
assert.match(js, /data-plan="pro_monthly"/);
assert.match(js, /data-plan="pro_annual"/);
assert.match(js, /R\$ 79,90\/mês/, 'mobile sales surfaces must show the current monthly price');
assert.match(js, /R\$ 799,90/, 'mobile sales surfaces must show the current annual price');
assert.match(js, /até 12x/i, 'annual plan must advertise installment availability');
assert.doesNotMatch(js, /R\$ 49,90/, 'old monthly price must not return to the mobile landing');
assert.doesNotMatch(js, /R\$ 499(?:<|\/)/, 'old annual price must not return to the mobile landing');
assert.match(css, /@media\s*\(min-width:\s*768px\)/, 'mobile-first CSS needs tablet enhancement');
assert.match(css, /@media\s*\(min-width:\s*1100px\)/, 'mobile-first CSS needs desktop enhancement');
assert.match(lightCss, /--sales-bg:\s*#f5edf0/i, 'commercial background must use the canonical brand-soft palette');
assert.match(lightCss, /--sales-text:\s*#2f3833/i, 'commercial text must use the canonical ink token');
assert.match(lightCss, /--sales-purple:\s*#6b3f50/i, 'commercial accents must use the canonical brand token');
assertSelectorColor(lightCss, '.sales-v2 .sales-hero h1', '#2f3833', 'hero title must remain readable on the light background');
assertSelectorColor(lightCss, '.sales-v2 .sales-hero h1 em', '#6b3f50', 'hero emphasis must use the canonical brand color');
assertSelectorColor(lightCss, '.sales-v2 .sales-section-head h2', '#2f3833', 'section titles must use dark ink');
assertSelectorColor(lightCss, '.sales-v2 .sales-section-head p', '#525b56', 'section descriptions must use readable secondary ink');
assertSelectorColor(lightCss, '.sales-v2 .sales-feature-grid h3', '#2f3833', 'feature titles must use dark ink');
assertSelectorColor(lightCss, '.sales-v2 .sales-feature-grid p', '#727a75', 'feature descriptions must use canonical muted text');
assertSelectorColor(lightCss, '.sales-v2 .sales-plan-card h3', '#2f3833', 'plan prices must use dark ink');
assertSelectorColor(lightCss, '.sales-v2 .sales-plan-card p', '#525b56', 'plan descriptions must remain readable');
assertSelectorColor(lightCss, '.sales-v2 .sales-faq summary', '#2f3833', 'FAQ questions must use dark ink');
assert.match(contrastFixCss, /body\.conversion-page\.sales-v2-active/, 'Sales V2 contrast fix must only apply after the new landing activates');
assert.match(contrastFixCss, /\.sales-v2 main h2/, 'Sales V2 contrast fix must outrank legacy phase2 heading colors');
assert.match(contrastFixCss, /\.sales-v2 main p/, 'Sales V2 contrast fix must outrank legacy phase2 paragraph colors');
assert.match(contrastFixCss, /color:\s*#2f3833/i, 'Sales V2 contrast fix must force dark heading ink');
assert.match(contrastFixCss, /color:\s*#525b56/i, 'Sales V2 contrast fix must force readable paragraph ink');
assert.match(js, /<img src="\/icon\.svg" alt="">/, 'commercial header/footer must use the canonical SVG logo');
assert.match(logo, /<svg\b/i, 'canonical logo must remain vector');
assert.doesNotMatch(logo, /<image\b/i, 'canonical logo must not embed a raster image');
assert.match(brandCss, /padding:\s*0\s*!important/i, 'brand wrapper must not shrink the SVG with padding');
assert.match(brandCss, /background:\s*transparent\s*!important/i, 'brand wrapper must not add a second gradient tile');
assert.match(brandCss, /overflow:\s*hidden/i, 'brand wrapper must clip the SVG directly to the approved radius');
assert.match(brandCss, /object-fit:\s*cover/i, 'canonical SVG must fill the brand mark surface');
assert.match(assetFix, /FINANCE_DEMO_PATIENT\s*=\s*['"]Mariana Alves['"]/i, 'commercial finance preview must use a fictitious patient');
assert.match(assetFix, /sales-finance-demo/i, 'finance card must render a sanitized demonstrative preview');
assert.doesNotMatch(assetFix, /\['Financeiro',\s*'\/comercial\/assets\/screens\/financeiro\.webp'\]/, 'commercial landing must not expose the real finance screenshot');
assert.match(seo, /mobile-sales-v2\.css/);
assert.match(seo, /brand-mark\.css\?v=20260921/, 'commercial edge markup must load the vector brand rendering fix');
assert.match(seo, /commercial-light-theme\.css\?v=20260921-contrast/, 'commercial edge markup must cache-bust the contrast fix');
assert.match(seo, /commercial-sales-v2-contrast-fix\.css\?v=20260921-2/, 'commercial edge markup must load the specificity isolation fix');
assert.match(seo, /mobile-sales-v2\.js\?v=20260922-pricing/, 'commercial edge markup must cache-bust the pricing update');
assert.match(seo, /price: '79\.90'/, 'SEO structured data must use the current monthly price');
assert.match(seo, /price: '799\.90'/, 'SEO structured data must use the current annual price');
assert.match(seo, /mobile-assets-fix\.js\?v=20260921/, 'commercial edge markup must load the privacy-safe finance preview');
assert.match(seo, /defer/);

console.log('Commercial mobile-first contract OK');
