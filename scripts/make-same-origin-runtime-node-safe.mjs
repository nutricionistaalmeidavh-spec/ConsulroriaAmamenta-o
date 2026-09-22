import { readFile, writeFile } from 'node:fs/promises';

const replacements = [
  ['public/feeding-assessment-history-feature.js', 'const FAH_SB_URL = window.location.origin;', "const FAH_SB_URL = globalThis.location?.origin || '';"],
  ['public/clinical-care-flow-feature.js', 'const CCF_SB_URL=window.location.origin;', "const CCF_SB_URL=globalThis.location?.origin||'';"],
  ['public/billing-v2.js', 'const BV_URL=window.location.origin;', "const BV_URL=globalThis.location?.origin||'';"],
  ['public/package-audit-feature.js', 'const PA_URL=window.location.origin;', "const PA_URL=globalThis.location?.origin||'';"],
  ['public/growth-feature.js', 'const SB_URL=window.location.origin;', "const SB_URL=globalThis.location?.origin||'';"],
];

for (const [path, oldValue, newValue] of replacements) {
  const source = await readFile(path, 'utf8');
  if (source.includes(newValue)) continue;
  if (!source.includes(oldValue)) throw new Error(`same-origin anchor missing in ${path}`);
  await writeFile(path, source.replace(oldValue, newValue), 'utf8');
}

console.log('same-origin browser runtimes are Node-safe');
