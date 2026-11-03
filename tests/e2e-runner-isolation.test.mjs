import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const script=String(pkg.scripts['test:e2e']||'');
const segments=script.split(/\s*&&\s*/g).map(part=>part.trim());

test('all browser projects run with their own Playwright process without dropping a project',()=>{
  const commands=segments.filter(command=>/\bplaywright test\b/.test(command));
  const expected=[
    'playwright test --project=chromium --shard=1/3',
    'playwright test --project=chromium --shard=2/3',
    'playwright test --project=chromium --shard=3/3',
    'playwright test --project=chromium-upgrade',
    'playwright test --project=chromium-service-worker',
  ];
  assert.deepEqual(commands,expected,'Every shard and SW project must run independently and in full');
});
test('E2E still builds the app and never skips/flattens or silently masks test failures',()=>{
  assert.ok(segments[0]==='npm run build','Fresh build remains part of the canonical gate');
  assert.doesNotMatch(script,/--grep-invert|--last-failed|\s--only-changed|\s--pass-with-no-tests|\s--retries|\s--max-failures|\|\|\s*true|;\s*exit\s+0/);
  assert.equal(segments.length,6,'Every suite must be connected with fail-fast &&');
});

test('final materialized gate runs every desktop shard independently without rebuilding the artifact',()=>{
  const source=readFileSync(new URL('../.github/workflows/validate-final-materialized-gate.yml',import.meta.url),'utf8');
  const desktop=source.match(/- name: Run functional desktop E2E on the final artifact([\s\S]*?)(?=\n\s*- name:)/)?.[1]||'';
  assert.ok(desktop,'Final build gate must retain its complete desktop browser step');
  const expected=[
    'npx playwright test --project=chromium --shard=1/3',
    'npx playwright test --project=chromium --shard=2/3',
    'npx playwright test --project=chromium --shard=3/3',
  ];
  for(const command of expected) assert.ok(desktop.includes(command),'Missing independent desktop shard: '+command);
  assert.doesNotMatch(desktop,/npx playwright test --project=chromium\s*(?:$|\n)/m,
    'Unsharded browser workers reintroduce the intermittent localhost crash');
  assert.match(source,/- name: Build final materialized artifact once/);
  assert.match(source,/npx playwright test --project=chromium-upgrade/);
  assert.match(source,/npx playwright test --project=chromium-service-worker/);
});
