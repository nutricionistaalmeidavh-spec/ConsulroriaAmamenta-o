import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('../public/apple-calendar-feature.js', import.meta.url), 'utf8');

test('Apple settings display a compact server-truthful connected state', () => {
  assert.match(script, /data-apple-state/);
  assert.match(script, /Link ativo/);
  assert.match(script, /data-apple-manage/);
  assert.match(script, /data-apple-manage-panel/);
  assert.match(script, /aria-expanded/);
  assert.doesNotMatch(script, /Assinatura ativa\. Seus agendamentos/);
  assert.doesNotMatch(script, /Gerar novo link \(revoga o anterior\)/);
});

test('The link is a one-time secret, and advanced actions are disclosed only when needed', () => {
  assert.match(script, /data-apple-subscription/);
  assert.match(script, /data-apple-rotate/);
  assert.match(script, /data-apple-revoke/);
  assert.match(script, /data-apple-copy/);
  assert.match(script, /data-apple-open/);
  assert.match(script, /sem nomes ou dados clínicos/);
  assert.match(script, /data-apple-privacy/);
  assert.match(script, /data-apple-url/);
  assert.doesNotMatch(script, /localStorage\.setItem\([^)]*(?:apple|calendar)/i);
});

test('Consequence, pending states and safe recovery are present', () => {
  assert.match(script, /data-apple-retry/);
  assert.match(script, /aria-busy/);
  assert.match(script, /Desativar compartilhamento/);
  assert.match(script, /Substituir link/);
  assert.match(script, /window\.confirm/);
  assert.match(script, /button\.disabled\s*=/);
  assert.match(script, /async function refresh/);
});
