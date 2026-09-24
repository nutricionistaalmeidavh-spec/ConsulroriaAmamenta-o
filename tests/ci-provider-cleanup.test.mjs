import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const provider = ['wood', 'pecker'].join('');
const root = process.cwd();
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'artifacts', 'test-results', 'playwright-report']);
const ignoredExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.zip', '.gz', '.bin', '.ico', '.pdf']);

function walk(directory, files = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

test('retired CI provider has no active repository artifacts or textual references', () => {
  const forbiddenPaths = [
    `.${provider}`,
    `scripts/${provider}-ci-report.mjs`,
    `docs/${provider.toUpperCase()}_QA.md`,
  ];

  for (const path of forbiddenPaths) {
    assert.equal(existsSync(join(root, path)), false, `retired CI artifact still exists: ${path}`);
  }

  const offenders = [];
  for (const file of walk(root)) {
    const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
    if (ignoredExtensions.has(extension)) continue;
    if (statSync(file).size > 2_000_000) continue;
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    if (content.toLowerCase().includes(provider)) offenders.push(relative(root, file));
  }

  assert.deepEqual(offenders, [], `retired CI provider references remain in: ${offenders.join(', ')}`);
});
