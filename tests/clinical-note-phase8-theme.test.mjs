import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const css = readFileSync(new URL('../public/phase8-design.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');

const rules = Array.from(
  css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ([, selectors, declarations]) => ({
    selectors: selectors.split(',').map((selector) => selector.trim()),
    declarations: declarations.split(';').map((declaration) => declaration.trim()),
  }),
);

function assertThemeRule(selector, property, token) {
  const declaration = rules
    .filter((rule) => rule.selectors.includes(selector))
    .flatMap((rule) => rule.declarations)
    .find((value) =>
      value.startsWith(`${property}:`) &&
      value.includes(`var(${token})`) &&
      value.endsWith('!important'),
    );
  assert.ok(declaration, `${selector} must use ${token} for ${property} with cascade priority`);
}

test('prontuário mantém a paleta Phase 8 mesmo com CSS clínico injetado depois', () => {
  assert.match(bootstrap, /\/phase8-design\.css/);
  assert.match(bootstrap, /features\/clinical-note-feature\.css/);
  assertThemeRule('#cn-overlay .cn-sheet', 'background', '--p8-surface');
  assertThemeRule('#cn-overlay .cn-head', 'background', '--p8-bg-deep');
  assertThemeRule('#cn-overlay .cn-avatar', 'background', '--p8-plum');
  assertThemeRule('#cn-overlay .cn-meta>div', 'border-color', '--p8-border');
  assertThemeRule('#cn-overlay .cn-foot .primary', 'background', '--p8-plum');
  assertThemeRule('#cn-overlay .cn-body>#cn-note:focus', 'box-shadow', '--p8-focus');
});

test('correção da data e status de salvamento seguem os tokens sem alterar lógica clínica', () => {
  assertThemeRule('#cn-overlay .cn-date-editor', 'background', '--p8-lilac-faint');
  assertThemeRule('#cn-overlay .cn-date-editor-actions button', 'background', '--p8-plum');
  assertThemeRule('#cn-overlay .cn-editor-head>span[data-tone=saved]', 'background', '--p8-sage-soft');
  assertThemeRule('#cn-overlay .cn-editor-head>span[data-tone=error]', 'color', '--p8-danger');
});

test('componentes de histórico e rascunho também seguem a identidade visual', () => {
  assertThemeRule('.cn-stepper-item.active', 'background', '--p8-plum');
  assertThemeRule('.cn-history', 'background', '--p8-surface');
  assertThemeRule('.cn-history-list b', 'color', '--p8-lilac-deep');
  assertThemeRule('.cn-draft-recovery', 'background', '--p8-lilac-faint');
});
