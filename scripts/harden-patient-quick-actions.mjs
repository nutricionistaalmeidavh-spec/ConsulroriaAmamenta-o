import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hardenPatientQuickActionsApp, hardenPatientQuickActionsHtml } from './lib/patient-quick-actions-hardening.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const WRITE = process.argv.includes('--write');
const targets = [
  { path: resolve(ROOT, 'public/clinical-source/index.html'), transform: hardenPatientQuickActionsHtml, markers: ['data-action="patient-whatsapp"', 'data-action="patient-call"', 'data-action="patient-route"', 'data-action="patient-add-media"'] },
  { path: resolve(ROOT, 'public/clinical-source/core/app-shell.js'), transform: hardenPatientQuickActionsApp, markers: ['currentPatientForQuickAction', "action === 'patient-whatsapp'", "action === 'patient-add-media'"] },
];

let changed = 0;
for (const target of targets) {
  const source = readFileSync(target.path, 'utf8');
  const next = target.transform(source);
  for (const marker of target.markers) if (!next.includes(marker)) throw new Error(`patient-quick-actions: marcador ausente ${marker}`);
  if (next !== source) { changed += 1; if (WRITE) writeFileSync(target.path, next, 'utf8'); }
}
if (!WRITE && changed) throw new Error(`patient-quick-actions: ${changed} arquivo(s) precisam ser materializados. Rode com --write.`);
console.log(`patient-quick-actions hardening: ${WRITE ? 'write' : 'verify'} OK (${changed} alterado(s))`);
