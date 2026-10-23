import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appleSubscriptionUrl,
  createAppleFeedToken,
  digestAppleFeedToken,
  handleAppleCalendarIntegration,
} from '../worker/apple-calendar-integration.js';

const owner = 'consultora-secreta';
const appointment = {
  id: 'agenda-123', owner_id: owner, starts_at: '2026-10-29T14:00:00.000Z',
  duration_min: 90, status: 'Agendado', mother_id: 'MAE-SECRETA',
  notes: 'DADOS CLINICOS CONFIDENCIAIS', address: 'ENDERECO SIGILOSO',
};

function mockEnv(tokenHash) {
  const sqlLog = [];
  const env = {
    CLINICAL_DB: {
      prepare(sql) {
        const stmt = {
          bind(...params) {
            sqlLog.push({ sql, params });
            return {
              async first() {
                if (sql.includes('calendar_apple_feeds')) {
                  return params[0] === tokenHash ? { owner_id: owner } : null;
                }
                return null;
              },
              async all() {
                if (sql.includes('supabase_records') && params[1] === owner && params[2] === owner)
                  return { results: [{ record_json: JSON.stringify(appointment) }] };
                return { results: [] };
              },
            };
          },
        };
        return stmt;
      },
    },
  };
  return { env, sqlLog };
}

test('Apple feed token is strong, opaque and hashed before storage', async () => {
  const a = createAppleFeedToken();
  const b = createAppleFeedToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.notEqual(await digestAppleFeedToken(a), a);
  assert.match(await digestAppleFeedToken(a), /^[a-f0-9]{64}$/);
});

test('Apple subscription points to the canonical HTTPS domain and native webcal link', () => {
  const token = 'a'.repeat(64);
  assert.equal(
    appleSubscriptionUrl(token),
    'https://deboralactacao.com/api/calendar/apple/feed/' + token + '.ics',
  );
});

test('Public Apple feed uses a revoked-capable token and excludes all clinical data', async () => {
  const token = createAppleFeedToken();
  const { env, sqlLog } = mockEnv(await digestAppleFeedToken(token));
  const url = appleSubscriptionUrl(token);
  const response = await handleAppleCalendarIntegration(new Request(url), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/calendar/i);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-robots-tag'), /noindex/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const body = await response.text();
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /BEGIN:VEVENT/);
  assert.match(body, /DTSTART:20261029T140000Z/);
  assert.match(body, /DTEND:20261029T153000Z/);
  assert.doesNotMatch(body, /MAE-SECRETA|DADOS CLINICOS CONFIDENCIAIS|ENDERECO SIGILOSO|consultora-secreta/);
  assert(sqlLog.some(x => x.sql.includes('calendar_apple_feeds') && x.params[0] !== token));
  assert(sqlLog.some(x => x.sql.includes('supabase_records') && x.params.includes(owner)));
});

test('Revoked or malformed token is rejected and does not expose calendar content', async () => {
  const token = createAppleFeedToken();
  const { env } = mockEnv('different_hash');
  const missing = await handleAppleCalendarIntegration(new Request(appleSubscriptionUrl(token)), env);
  assert.equal(missing.status, 404);
  assert.doesNotMatch(await missing.text(), /BEGIN:VEVENT|MAE-SECRETA/);
  const invalid = await handleAppleCalendarIntegration(
    new Request('https://deboralactacao.com/api/calendar/apple/feed/invalid.ics'), env,
  );
  assert.equal(invalid.status, 404);
});

test('Admin Apple endpoints require a valid session; Google routes are unaffected', async () => {
  const { env } = mockEnv('different_hash');
  for (const [path, method] of [
    ['/api/calendar/apple/status', 'GET'],
    ['/api/calendar/apple/create', 'POST'],
    ['/api/calendar/apple/revoke', 'POST'],
  ]) {
    const response = await handleAppleCalendarIntegration(new Request(
      'https://deboralactacao.com' + path, { method },
    ), env);
    assert.equal(response.status, 401);
  }
  const response = await handleAppleCalendarIntegration(
    new Request('https://deboralactacao.com/api/calendar/google/status'), env,
  );
  assert.equal(response, null);
});

test('Apple subscription works with HEAD and never returns a token body', async () => {
  const token = createAppleFeedToken();
  const { env } = mockEnv(await digestAppleFeedToken(token));
  const response = await handleAppleCalendarIntegration(
    new Request(appleSubscriptionUrl(token), { method: 'HEAD' }), env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('The clinical settings lets consultants choose Google or Apple without removing the manual ICS option', async () => {
  const { readFileSync } = await import('node:fs');
  const script = readFileSync(new URL('../public/calendar-integration-feature.js', import.meta.url), 'utf8');
  assert.match(script, /data-calendar-provider/);
  assert.match(script, /value=\\"google\\"/);
  assert.match(script, /value=\\"apple\\"/);
  assert.match(script, /data-calendar-apple/);
  assert.match(script, /data-apple-create/);
  assert.match(script, /data-apple-revoke/);
  assert.match(script, /data-apple-copy/);
  assert.match(script, /data-apple-open/);
  assert.match(script, /data-calendar-ics/);
  assert.match(script, /localStorage/);
  assert.match(script, /sessionStorage/);
  assert.match(script, /refreshQueued/);
});
