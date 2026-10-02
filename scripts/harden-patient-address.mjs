import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hardenPatientAddressApp, hardenPatientAddressHtml } from './lib/patient-address-hardening.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const WRITE = process.argv.includes('--write');
const targets = [
  {
    path: resolve(ROOT, 'public/clinical-source/index.html'),
    transform: hardenPatientAddressHtml,
    markers: ['name="motherAddress"', 'data-mother-address', 'data-encounter-field="address"'],
  },
  {
    path: resolve(ROOT, 'public/clinical-source/core/app-shell.js'),
    transform: hardenPatientAddressApp,
    markers: ["val('motherAddress'", "address: get('motherAddress').trim()", 'syncEncounterAddressFromPatient', 'encounterAddressForFormat', 'routeAddressForAppointment', 'isOnlineFormat', "choice.dataset.field === 'format'"],
  },
];

let changed = 0;
for (const target of targets) {
  const source = readFileSync(target.path, 'utf8');
  const next = target.transform(source);
  for (const marker of target.markers) if (!next.includes(marker)) throw new Error(`patient-address: marcador ausente ${marker}`);
  if (next !== source) {
    changed += 1;
    if (WRITE) writeFileSync(target.path, next, 'utf8');
  }
}
if (!WRITE && changed) throw new Error(`patient-address: ${changed} arquivo(s) precisam ser materializados. Rode com --write.`);
console.log(`patient-address hardening: ${WRITE ? 'write' : 'verify'} OK (${changed} alterado(s))`);
