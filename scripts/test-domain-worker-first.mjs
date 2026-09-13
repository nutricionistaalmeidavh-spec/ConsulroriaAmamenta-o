import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wrangler = readFileSync('wrangler.jsonc', 'utf8');

assert.match(
  wrangler,
  /"run_worker_first"\s*:\s*true/,
  'custom-domain hostname routing requires the Worker to run before static assets on every path',
);

console.log('custom-domain worker-first contract: ok');
