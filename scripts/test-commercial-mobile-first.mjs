import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const js = read('public/comercial/mobile-sales-v2.js');
const css = read('public/comercial/mobile-sales-v2.css');
const brandCss = read('public/comercial/brand-mark.css');
const logo = read('public/icon.svg');
const seo = read('worker/commercial-seo.js');

assert.match(js, /Sistema para consultoras de amamentação/i, 'hero must state commercial search intent');
assert.ok((js.match(/data-purchase-card/g) || []).length >= 4, 'landing must contain multiple purchase cards');
assert.match(js, /dashboard\.webp/);
assert.match(css, /real-screens-sprite-small\.webp/);
assert.match(js, /data-plan="freemium"/);
assert.match(js, /data-plan="pro_monthly"/);
assert.match(js, /data-plan="pro_annual"/);
assert.match(css, /@media\s*\(min-width:\s*768px\)/, 'mobile-first CSS needs tablet enhancement');
assert.match(css, /@media\s*\(min-width:\s*1100px\)/, 'mobile-first CSS needs desktop enhancement');
assert.match(css, /--sales-bg:\s*#140e16/i, 'approved dark plum direction must be encoded');
assert.match(js, /<img src="\/icon\.svg" alt="">/, 'commercial header/footer must use the canonical SVG logo');
assert.match(logo, /<svg\b/i, 'canonical logo must remain vector');
assert.doesNotMatch(logo, /<image\b/i, 'canonical logo must not embed a raster image');
assert.match(brandCss, /padding:\s*0\s*!important/i, 'brand wrapper must not shrink the SVG with padding');
assert.match(brandCss, /background:\s*transparent\s*!important/i, 'brand wrapper must not add a second gradient tile');
assert.match(brandCss, /overflow:\s*hidden/i, 'brand wrapper must clip the SVG directly to the approved radius');
assert.match(brandCss, /object-fit:\s*cover/i, 'canonical SVG must fill the brand mark surface');
assert.match(seo, /mobile-sales-v2\.css/);
assert.match(seo, /brand-mark\.css\?v=20260921/, 'commercial edge markup must load the vector brand rendering fix');
assert.match(seo, /mobile-sales-v2\.js/);
assert.match(seo, /defer/);

console.log('Commercial mobile-first contract OK');



