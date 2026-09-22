import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentityProbeSql } from './demo-account-sql.mjs';

export const DEMO_D1_DATABASE = 'debora-lactacao-clinical';

function npxExecutable() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

export function buildWranglerQueryArgs(sql) {
  return ['--yes', 'wrangler@4', 'd1', 'execute', DEMO_D1_DATABASE, '--remote', '--command', String(sql), '--json'];
}

export function buildWranglerFileArgs(filePath) {
  return ['--yes', 'wrangler@4', 'd1', 'execute', DEMO_D1_DATABASE, '--remote', '--file', filePath, '--yes'];
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

export function extractD1Rows(output) {
  const text = stripAnsi(output).trim();
  if (!text) return [];
  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    const startArray = text.indexOf('[');
    const startObject = text.indexOf('{');
    const starts = [startArray, startObject].filter((value) => value >= 0);
    if (!starts.length) throw new Error('demo_d1_json_missing');
    parsed = JSON.parse(text.slice(Math.min(...starts)));
  }
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const envelope of envelopes) {
    if (Array.isArray(envelope?.results)) rows.push(...envelope.results);
    else if (Array.isArray(envelope?.result?.results)) rows.push(...envelope.result.results);
    else if (Array.isArray(envelope?.result)) rows.push(...envelope.result);
  }
  return rows;
}

export async function queryD1(sql, { execFile = execFileSync } = {}) {
  const output = execFile(npxExecutable(), buildWranglerQueryArgs(sql), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return extractD1Rows(output);
}

export async function executeD1Sql(sql, {
  execFile = execFileSync,
  writeFile = writeFileSync,
  unlinkFile = unlinkSync,
  tempDirectory = tmpdir(),
} = {}) {
  const filePath = join(tempDirectory, `debora-demo-${randomUUID()}.sql`);
  writeFile(filePath, String(sql), { encoding: 'utf8', mode: 0o600 });
  try {
    execFile(npxExecutable(), buildWranglerFileArgs(filePath), {
      encoding: 'utf8',
      stdio: ['ignore', 'inherit', 'inherit'],
    });
  } finally {
    try { unlinkFile(filePath); } catch {}
  }
}

export async function probeDemoIdentity(options = {}) {
  return queryD1(buildIdentityProbeSql(), options);
}
