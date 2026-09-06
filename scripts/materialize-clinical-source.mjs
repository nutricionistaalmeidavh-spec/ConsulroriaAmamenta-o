import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { unzipSync } from 'fflate';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = resolve(ROOT, 'public');
const OUT = resolve(PUBLIC, 'clinical-source');
const mode = process.argv.includes('--write') ? 'write' : 'verify';

const BASE_PARTS = [1, 2, 3, 4].map((part) => resolve(PUBLIC, `debora-app-${part}.bin`));
const RELEASE_PARTS = Array.from({ length: 8 }, (_, index) => resolve(PUBLIC, `release-1.11.0-patch-${index + 1}.txt`));
const AGENDA_PARTS = Array.from({ length: 4 }, (_, index) => resolve(PUBLIC, `release-1.12.0-agenda-${index + 1}.txt`));

function decodeMaybeBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length || bytes.length % 4 !== 0) return bytes;
  const text = Buffer.from(bytes).toString('ascii');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return bytes;
  try {
    return new Uint8Array(Buffer.from(text, 'base64'));
  } catch {
    return bytes;
  }
}

function merge(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    merged.set(part, cursor);
    cursor += part.byteLength;
  }
  return merged;
}

function loadBaseArchive() {
  const merged = merge(BASE_PARTS.map((path) => decodeMaybeBase64(readFileSync(path))));
  if (merged[0] !== 80 || merged[1] !== 75) throw new Error('Pacote base inválido.');
  return unzipSync(merged);
}

function loadTextPatch(parts, label) {
  const encoded = parts.map((path) => readFileSync(path, 'utf8')).join('').replace(/\s+/g, '');
  const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
  if (bytes[0] !== 80 || bytes[1] !== 75) throw new Error(`${label} inválido.`);
  return unzipSync(bytes);
}

function requireEntry(entries, path, label) {
  const value = entries[path];
  if (!value) throw new Error(`${label}: arquivo ausente ${path}`);
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
}

const base = loadBaseArchive();
const release = loadTextPatch(RELEASE_PARTS, 'Release clínica');
const agenda = loadTextPatch(AGENDA_PARTS, 'Patch da Agenda');

const resolved = new Map();
const sourceByPath = new Map();

function add(outputPath, entries, entryPath, source) {
  resolved.set(outputPath, requireEntry(entries, entryPath, source));
  sourceByPath.set(outputPath, source);
}

add('index.html', base, 'index.html', 'base:index.html');
add('styles.css', base, 'styles.css', 'base:styles.css');
add('config.js', base, 'config.js', 'base:config.js');

const libPaths = [
  'lib/supabase-client.js',
  'lib/auth-service.js',
  'lib/repositories.js',
  'lib/app-data.js',
  'lib/encounter-form.js',
  'lib/media-service.js',
  'lib/backup-service.js',
  'lib/pdf-service.js'
];

for (const libPath of libPaths) {
  const agendaPath = `core/${libPath}`;
  const releasePath = `core/${libPath}`;
  if (agenda[agendaPath]) add(`core/${libPath}`, agenda, agendaPath, `agenda:${agendaPath}`);
  else if (release[releasePath]) add(`core/${libPath}`, release, releasePath, `release:${releasePath}`);
  else add(`core/${libPath}`, base, libPath, `base:${libPath}`);
}

if (agenda['core/app-shell.js']) add('core/app-shell.js', agenda, 'core/app-shell.js', 'agenda:core/app-shell.js');
else add('core/app-shell.js', release, 'core/app-shell.js', 'release:core/app-shell.js');

add('features/clinical-note-feature.js', release, 'features/clinical-note-feature.js', 'release:features/clinical-note-feature.js');
add('features/clinical-note-feature.css', release, 'features/clinical-note-feature.css', 'release:features/clinical-note-feature.css');
if (release['features/patient-fixes.js']) add('features/patient-fixes.js', release, 'features/patient-fixes.js', 'release:features/patient-fixes.js');
if (release['features/patient-fixes.css']) add('features/patient-fixes.css', release, 'features/patient-fixes.css', 'release:features/patient-fixes.css');

const modules = {};
for (const [outputPath, bytes] of [...resolved.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  modules[outputPath] = {
    promoted: true,
    source: sourceByPath.get(outputPath),
    sha256: sha256(bytes)
  };
}

const manifest = Buffer.from(`${JSON.stringify({
  version: 2,
  strategy: 'canonical-first-with-legacy-fallback',
  generatedFromLegacyArtifacts: true,
  modules
}, null, 2)}\n`, 'utf8');
resolved.set('manifest.json', new Uint8Array(manifest));

let mismatches = 0;
for (const [outputPath, bytes] of resolved) {
  const destination = resolve(OUT, outputPath);
  if (mode === 'write') {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(bytes));
    continue;
  }
  if (!existsSync(destination)) {
    console.error(`missing ${outputPath}`);
    mismatches += 1;
    continue;
  }
  const current = readFileSync(destination);
  if (!current.equals(Buffer.from(bytes))) {
    console.error(`mismatch ${outputPath}`);
    mismatches += 1;
  }
}

if (mode === 'write') {
  console.log(`Materialized ${resolved.size - 1} clinical source files plus manifest.`);
} else if (mismatches) {
  console.error(`Clinical source verification failed: ${mismatches} mismatch(es).`);
  process.exit(1);
} else {
  console.log(`Clinical source verified: ${resolved.size - 1} files match legacy runtime resolution.`);
}
