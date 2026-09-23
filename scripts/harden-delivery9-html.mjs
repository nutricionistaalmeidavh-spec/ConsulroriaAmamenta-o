import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const BILLING = resolve(ROOT, 'public', 'billing-v2.js');

const ESCAPE_HELPER = `function bvEscapeHtml(value){return String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}`;

export function hardenBillingHtml(source) {
  let next = String(source);
  if (!next.includes('function bvEscapeHtml(value)')) {
    next = next.replace(
      "function bvMoney(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}",
      "function bvMoney(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\n" + ESCAPE_HELPER,
    );
  }

  next = next
    .replaceAll("'+p.id+'", "'+bvEscapeHtml(p.id)+'")
    .replaceAll("String(p.service_label||'Plano')", "bvEscapeHtml(p.service_label||'Plano')")
    .replaceAll("String(active.service_label||'Plano ativo')", "bvEscapeHtml(active.service_label||'Plano ativo')")
    .replaceAll("String(item.label||'Serviço')", "bvEscapeHtml(item.label||'Serviço')")
    .replaceAll("'+item.id+'", "'+bvEscapeHtml(item.id)+'")
    .replaceAll("'+pkg.id+'", "'+bvEscapeHtml(pkg.id)+'")
    .replaceAll("String(pkg.service_label||'Plano de acompanhamento')", "bvEscapeHtml(pkg.service_label||'Plano de acompanhamento')");

  return next;
}

export function validateBillingHtml(source) {
  const required = [
    'function bvEscapeHtml(value)',
    "bvEscapeHtml(p.service_label||'Plano')",
    "bvEscapeHtml(active.service_label||'Plano ativo')",
    "bvEscapeHtml(item.label||'Serviço')",
    'data-bv-use-item="\'+bvEscapeHtml(item.id)+\'"',
    'data-bv-plan-id="\'+bvEscapeHtml(pkg.id)+\'"',
    'data-bv-add-item="\'+bvEscapeHtml(pkg.id)+\'"',
  ];
  const missing = required.filter((marker) => !source.includes(marker));
  if (missing.length) throw new Error(`Delivery 9 billing HTML hardening missing: ${missing.join(', ')}`);
  if (source.includes("<strong>'+String(item.label") || source.includes("<h2>'+String(pkg.service_label")) {
    throw new Error('Delivery 9 billing HTML hardening left persisted labels unescaped.');
  }
}

function run() {
  if (!existsSync(BILLING)) throw new Error('public/billing-v2.js não encontrado.');
  const source = readFileSync(BILLING, 'utf8');
  const hardened = hardenBillingHtml(source);
  validateBillingHtml(hardened);
  const write = process.argv.includes('--write');
  if (write) {
    if (hardened !== source) writeFileSync(BILLING, hardened, 'utf8');
    console.log(`Delivery 9 HTML hardening write: ${hardened === source ? 'verified' : 'updated'}`);
    return;
  }
  if (hardened !== source) {
    console.error('Delivery 9 HTML hardening check failed: public/billing-v2.js needs regeneration.');
    process.exit(1);
  }
  console.log('Delivery 9 HTML hardening check: verified');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
