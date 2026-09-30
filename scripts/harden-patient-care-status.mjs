import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hardenPatientCareApp, hardenPatientCareHtml } from './lib/patient-care-status-hardening.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const WRITE = process.argv.includes('--write');

const targets = [
  {
    path: resolve(ROOT, 'public/clinical-source/index.html'),
    transform: hardenPatientCareHtml,
    markers: ['data-kpi-active-patients', 'data-patient-care-toggle', 'data-patient-care-status'],
  },
  {
    path: resolve(ROOT, 'public/clinical-source/core/app-shell.js'),
    transform: hardenPatientCareApp,
    markers: ['normalizePatientCareStatus', 'finalizeCurrentPatientCare', 'ensurePatientCareActive'],
  },
];

let changed = 0;
for (const target of targets) {
  const source = readFileSync(target.path, 'utf8');
  const next = target.transform(source);
  for (const marker of target.markers) {
    if (!next.includes(marker)) throw new Error(`patient-care-status: marcador ausente ${marker} em ${target.path}`);
  }
  if (next !== source) {
    changed += 1;
    if (WRITE) writeFileSync(target.path, next, 'utf8');
  }
}

if (!WRITE && changed) {
  throw new Error(`patient-care-status: ${changed} arquivo(s) ainda precisam ser materializados. Rode com --write.`);
}

console.log(`patient-care-status hardening: ${WRITE ? 'write' : 'verify'} OK (${changed} alterado(s))`);
