import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const textExtensions = new Set(['.js', '.mjs', '.html', '.json', '.webmanifest']);
const retiredPatterns = [
  /zxowxdfhtksevhnjmeyu/i,
  /https:\/\/[^'"`\s]+\.supabase\.co/i,
  /sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt/i,
];

assert.ok(existsSync(dist), 'dist/ is required; run the build before this guard');

const offenders = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const source = readFileSync(full, 'utf8');
    const matchesRetiredBackend = retiredPatterns.some((pattern) => pattern.test(source));
    if (!matchesRetiredBackend) continue;

    // Block 4 intentionally keeps only the fetch bridge as a temporary compatibility shim.
    // Vite may hash/bundle its filename, so identify that one allowed artifact by its runtime sentinel.
    if (source.includes('__deboraCloudflareFetchBridge')) continue;
    offenders.push(relative(dist, full).replaceAll('\\', '/'));
  }
};

walk(dist);
assert.deepEqual(
  offenders,
  [],
  `retired Supabase origin/key leaked into built runtime outside the transitional fetch bridge:\n${offenders.join('\n')}`,
);
console.log('Block 4 built-runtime guard passed.');
