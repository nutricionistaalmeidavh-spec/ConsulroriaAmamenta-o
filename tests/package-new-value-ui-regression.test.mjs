import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../public/mobile-layout-integrity.css', import.meta.url), 'utf8');

test('novo plano mantém o campo de valor total legível', () => {
  assert.match(
    css,
    /\.unit-input:has\(\[data-bv-total\]\)\s*\{[^}]*grid-template-columns\s*:\s*42px\s+minmax\(120px,\s*1fr\)/s,
  );
  assert.match(
    css,
    /\.unit-input:has\(\[data-bv-total\]\)>\[data-bv-total\]\s*\{[^}]*grid-column\s*:\s*2[^}]*width\s*:\s*100%/s,
  );
});

test('novo plano oculta o campo duplicado do valor do atendimento', () => {
  assert.match(
    css,
    /\.appointment-screen:has\(\[data-bv-mode\]\s+option\[value="package_new"\]:checked\)\s+\.appointment-meta-grid>\.field:has\(\[data-encounter-field="value"\]\)\s*\{[^}]*display\s*:\s*none/s,
  );
});
