import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const personalizationPath = resolve(root, 'public/professional-personalization-feature.js');
const mobileCssPath = resolve(root, 'public/mobile-qa.css');
const personalizationExists = existsSync(personalizationPath);

const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('phase 7: personalization module exists and is wired in both app entry points', () => {
  assert.equal(personalizationExists, true, 'professional personalization feature must exist');
  assert.match(read('index.html'), /professional-personalization-feature\.js/);
  assert.match(read('app/index.html'), /professional-personalization-feature\.js/);
});

test('phase 7: professional profile normalization keeps safe fallback and business precedence', { skip: !personalizationExists }, async () => {
  const feature = await import(`${pathToFileURL(personalizationPath).href}?profile=${Date.now()}`);
  assert.equal(feature.professionalBrandName({}), 'Débora Lactação');
  assert.equal(feature.professionalBrandName({ professional_name: 'Ana Souza' }), 'Ana Souza');
  assert.equal(feature.professionalBrandName({ professional_name: 'Ana Souza', business_name: 'Clínica Ninho' }), 'Clínica Ninho');
  assert.equal(feature.professionalDisplayName({ professional_name: 'Ana Souza', business_name: 'Clínica Ninho' }), 'Ana Souza');
  assert.equal(feature.professionalInitials({ professional_name: 'Ana Souza' }), 'AS');
});

test('phase 7: personalization reads and writes only the authenticated professional profile surface', { skip: !personalizationExists }, () => {
  const source = read('public/professional-personalization-feature.js');
  assert.match(source, /professional_profiles/);
  assert.match(source, /saas_accounts/);
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE/);
  assert.match(source, /professional_name/);
  assert.match(source, /business_name/);
  assert.match(source, /phone/);
  assert.match(source, /logo_url/);
});

test('phase 7: clinical PDFs resolve branding from the active professional profile while preserving default', () => {
  const documentPdf = read('public/document-pdf-service.js');
  const carePlanPdf = read('public/clinical-source/core/lib/pdf-service.js');
  for (const source of [documentPdf, carePlanPdf]) {
    assert.match(source, /DEBORA_PROFESSIONAL_PROFILE/);
    assert.match(source, /Débora Lactação/);
  }
});

test('phase 8: mobile QA stylesheet is wired and enforces touch/safe-area contracts', () => {
  assert.equal(existsSync(mobileCssPath), true, 'mobile QA stylesheet must exist');
  assert.match(read('index.html'), /mobile-qa\.css/);
  assert.match(read('app/index.html'), /mobile-qa\.css/);
  const css = read('public/mobile-qa.css');
  assert.match(css, /env\(safe-area-inset-bottom/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /font-size:\s*16px/);
  assert.match(css, /overflow-x:\s*clip|overflow-x:\s*hidden/);
  assert.match(css, /prefers-reduced-motion/);
});

test('phase 8: canonical mobile shell keeps iOS viewport and five primary bottom navigation targets', () => {
  const html = read('public/clinical-source/index.html');
  assert.match(html, /viewport-fit=cover/);
  const nav = html.match(/<nav class="lactation-bottom-nav"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((nav.match(/data-mobile-target=/g) || []).length, 5);
  for (const target of ['home', 'agenda', 'patients', 'followups', 'more']) assert.match(nav, new RegExp(`data-mobile-target="${target}"`));
});

test('phase 8: QA remains additive and does not remove the existing 7-step encounter wizard', () => {
  const html = read('public/clinical-source/index.html');
  assert.equal((html.match(/data-wizard-step=/g) || []).length, 7);
  assert.match(read('public/clinical-care-flow-feature.js'), /CONDUTA E MANEJO/);
  assert.match(read('public/feeding-assessment-history-feature.js'), /Registrar atendimento/);
});
