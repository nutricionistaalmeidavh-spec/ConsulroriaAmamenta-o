import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const css = readFileSync(join(ROOT, 'public/mobile-layout-integrity.css'), 'utf8');
const billing = readFileSync(join(ROOT, 'public/billing-v2.js'), 'utf8');
const bootstrap = readFileSync(join(ROOT, 'src/bootstrap.js'), 'utf8');

function walk(dir) {
  const output = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) output.push(...walk(path));
    else if (/\.(?:js|mjs|html)$/i.test(name)) output.push(path);
  }
  return output;
}

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

test('novo plano oculta o campo legado sem removê-lo do fluxo de persistência', () => {
  assert.match(
    css,
    /\.appointment-screen:has\(\[data-bv-mode\]\s+option\[value="package_new"\]:checked\)\s+\.appointment-meta-grid>\.field:has\(\[data-encounter-field="value"\]\)\s*\{[^}]*display\s*:\s*none/s,
  );
  assert.match(billing, /function bvValueInput\(\)\{return document\.querySelector\('\[data-encounter-field="value"\]'\)\}/);
  assert.match(billing, /mode==='package_new'[^\n]*bvPackageTotalCents\(\)[^\n]*input\.readOnly=true/);
});

test('há um único renderer de input do valor do novo plano no runtime de produção', () => {
  const owners = [];
  for (const root of ['public', 'src', 'patch-source']) {
    for (const file of walk(join(ROOT, root))) {
      const source = readFileSync(file, 'utf8');
      if (source.includes('<input data-bv-total')) owners.push(relative(ROOT, file).replaceAll('\\', '/'));
    }
  }
  assert.deepEqual(owners, ['public/billing-v2.js']);
  assert.equal((billing.match(/<input data-bv-total/g) || []).length, 1);
});

test('mount do billing reutiliza o host e o bootstrap carrega uma única cópia do renderer e da correção', () => {
  assert.match(billing, /const hostExisting=document\.querySelector\('\[data-billing-v2\]'\)/);
  assert.match(billing, /if\(!host\)\{host=document\.createElement\('section'\);host\.dataset\.billingV2=''/);
  assert.equal((bootstrap.match(/href="\/mobile-layout-integrity\.css"/g) || []).length, 1);
  assert.equal((bootstrap.match(/src="\/billing-v2\.js"/g) || []).length, 1);
});
