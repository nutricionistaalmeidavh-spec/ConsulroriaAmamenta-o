import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIdentityProbeSql } from './demo-account-sql.mjs';

export const DEMO_D1_DATABASE = 'debora-lactacao-clinical';

export function buildNpxInvocation(args, {
  platform = process.platform,
  comspec = process.env.ComSpec,
} = {}) {
  const npxArgs = Array.from(args || [], (value) => String(value));
  if (platform === 'win32') {
    return {
      command: String(comspec || 'cmd.exe'),
      args: ['/d', '/s', '/c', 'npx', ...npxArgs],
    };
  }
  return { command: 'npx', args: npxArgs };
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
  const invocation = buildNpxInvocation(buildWranglerQueryArgs(sql));
  const output = execFile(invocation.command, invocation.args, {
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
    const invocation = buildNpxInvocation(buildWranglerFileArgs(filePath));
    execFile(invocation.command, invocation.args, {
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
