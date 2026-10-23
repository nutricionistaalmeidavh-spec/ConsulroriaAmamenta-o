import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('Google OAuth legal documents are public static HTML with privacy and consent details', () => {
  const privacy = read('public/comercial/privacidade/index.html');
  const terms = read('public/comercial/termos/index.html');
  for (const [name, html] of [['privacidade', privacy], ['termos', terms]]) {
    assert.match(html, /<!doctype html>/i, name);
    assert.match(html, /<html lang="pt-BR">/i, name);
    assert.match(html, /<meta name="viewport"/i, name);
    assert.match(html, /<main\b/i, name);
    assert.match(html, /deboralactacao\.com/i, name);
    assert.doesNotMatch(html, /<script|access_token|Bearer\s/i, name);
  }
  assert.match(privacy, /Política de Privacidade/i);
  assert.match(privacy, /LGPD/i);
  assert.match(privacy, /Google Agenda/i);
  assert.match(privacy, /calendar\.events/i);
  assert.match(privacy, /calendar\.calendarlist\.readonly/i);
  assert.match(privacy, /revogar/i);
  assert.match(terms, /Termos de (Uso|Serviço)/i);
  assert.match(terms, /assinatura/i);
  assert.match(terms, /paciente/i);
});

test('legal pages use public Cloudflare assets and commercial footer links', () => {
  const footer = read('public/comercial/index.html');
  assert.match(footer, /href="\.\/privacidade\/"[^>]*>Política de Privacidade/i);
  assert.match(footer, /href="\.\/termos\/"[^>]*>Termos de Uso/i);
  for (const route of ['privacidade', 'termos']) {
    const canonical = resolvePublicHostRoute('https://deboralactacao.com/comercial/' + route + '/');
    assert.equal(canonical.type, 'passthrough');
    const legacy = resolvePublicHostRoute('https://comercial.deboralactacao.com/' + route + '/');
    assert.equal(legacy.type, 'redirect');
    assert.equal(legacy.location, 'https://deboralactacao.com/comercial/' + route + '/');
  }
});
