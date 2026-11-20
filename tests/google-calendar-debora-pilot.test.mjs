import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentToEvent, appointmentsToIcs, googleAuthorizeUrl, googleEventId } from '../worker/google-calendar-integration.js';

const appointment = {
  id: 'a-b-c', owner_id: 'consultora-1', starts_at: '2026-10-28T13:00:00.000Z',
  duration_min: 60, status: 'Agendado', mother_id: 'mae-secreta',
  notes: 'Diagnóstico reservado', address: 'Rua Privada', appointment_type: 'Puerpério',
};

test('export ICS has valid times, stable UID and never exposes private clinical fields', () => {
  const ics = appointmentsToIcs([appointment], 'consultora-1');
  assert.match(ics, /BEGIN:VCALENDAR\r\nVERSION:2.0/);
  assert.match(ics, /DTSTART:20261028T130000Z/);
  assert.match(ics, /DTEND:20261028T140000Z/);
  assert.match(ics, /UID:a-b-c@gestao-amamentacao/);
  assert.doesNotMatch(ics, /mae-secreta|Diagnóstico reservado|Rua Privada|Puerpério/);
});

test('ICS excludes cancelled and invalid appointments', () => {
  const ics = appointmentsToIcs([{ ...appointment, status: 'Cancelado' }, { id: 'invalid', starts_at: 'invalid' }], 'consultora-1');
  assert.doesNotMatch(ics, /BEGIN:VEVENT/);
});

test('Google event is privacy preserving and keeps times', () => {
  const event = appointmentToEvent(appointment, 'cal_123');
  assert.deepEqual(event.start, { dateTime: '2026-10-28T13:00:00.000Z' });
  assert.deepEqual(event.end, { dateTime: '2026-10-28T14:00:00.000Z' });
  assert.equal(event.summary, 'Atendimento - Gestão Amamentação');
  assert.equal(event.visibility, 'private');
  assert.doesNotMatch(JSON.stringify(event), /mae-secreta|Diagnóstico reservado|Rua Privada|Puerpério/);
});

test('Google event IDs are deterministic and within allowed charset', async () => {
  const a = await googleEventId('user-1', 'appointment-1');
  const b = await googleEventId('user-1', 'appointment-1');
  assert.equal(a, b);
  assert.match(a, /^[a-v0-9]{32}$/);
  assert.notEqual(a, await googleEventId('user-2', 'appointment-1'));
});

test('authorization URL requests offline access and scoped permissions', () => {
  const uri = googleAuthorizeUrl('client-id', 'https://app.deboralactacao.com/api/calendar/google/callback', 'opaque-state');
  const parsed = new URL(uri);
  assert.equal(parsed.searchParams.get('access_type'), 'offline');
  assert.equal(parsed.searchParams.get('state'), 'opaque-state');
  assert.equal(parsed.searchParams.get('redirect_uri'), 'https://app.deboralactacao.com/api/calendar/google/callback');
  assert.match(parsed.searchParams.get('scope'), /calendar\.events/);
  assert.match(parsed.searchParams.get('scope'), /calendar\.calendarlist\.readonly/);
  assert.doesNotMatch(uri, /client_secret/);
});

import { readFileSync } from 'node:fs';
import { isGoogleTesterAccount } from '../worker/google-calendar-integration.js';

test('Only the exact authenticated Debora pilot account is eligible', () => {
  assert.equal(isGoogleTesterAccount({ id: 'id-debora', email: 'd.moreira.garcia9393@gmail.com' }), true);
  assert.equal(isGoogleTesterAccount({ id: 'id-debora', email: ' D.MOREIRA.GARCIA9393@GMAIL.COM ' }), true);
  assert.equal(isGoogleTesterAccount({ id: 'id-other', email: 'test@example.test' }), false);
  assert.equal(isGoogleTesterAccount({ id: 'id-debora' }), false);
  assert.equal(isGoogleTesterAccount({ email: 'd.moreira.garcia9393@gmail.com' }), false);
  assert.equal(isGoogleTesterAccount(null), false);
});

test('Google panel is only attached after eligibility check, Apple remains independent', () => {
  const front = readFileSync(new URL('../public/google-calendar-debora-feature.js', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../src/bootstrap.js', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../worker/google-calendar-integration.js', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../worker/domain-entry.js', import.meta.url), 'utf8');
  assert.match(front, /api\/calendar\/google\/eligibility/);
  assert.match(front, /!eligibility\.ok/);
  assert.match(front, /data-google-calendar-integrations/);
  assert.match(front, /localStorage/);
  assert.match(front, /sessionStorage/);
  assert.match(bootstrap, /apple-calendar-feature\.js/);
  assert.match(bootstrap, /google-calendar-debora-feature\.js/);
  assert.match(entry, /handleAppleCalendarIntegration/);
  assert.match(entry, /handleGoogleCalendarIntegration/);
  assert.match(worker, /isGoogleTesterAccount\(user\)/);
  assert.match(worker, /isGoogleTesterAccount\(callbackOwner\)/);
  assert.match(worker, /isGoogleTesterAccount\(syncOwner\)/);
  assert.match(worker, /isGoogleTesterAccount\(user\)\) return response/);
});

test('Cloudflare Worker rejects other users on all protected Google Calendar actions', async () => {
  const { createLocalRuntime, userId } = await import('./helpers/cloudflare-local.mjs');
  const runtime = await createLocalRuntime({
    bindings: {
      GOOGLE_CALENDAR_CLIENT_ID: 'test-id.apps.googleusercontent.com',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'LOCAL_FAKE_ONLY',
      GOOGLE_CALENDAR_REDIRECT_URI: 'https://app.deboralactacao.com/api/calendar/google/callback',
      GOOGLE_CALENDAR_TOKEN_KEY: '1'.repeat(64),
    },
  });
  try {
    const unauthorized = await runtime.mf.dispatchFetch('http://localhost/api/calendar/google/eligibility');
    assert.equal(unauthorized.status, 401);
    const anon = await unauthorized.json();
    assert.equal(anon.error, 'cloudflare_auth_required');

    const other = await runtime.login();
    const bearer = other.access_token;
    const auth = { Authorization: 'Bearer ' + bearer };
    const eligibleOther = await runtime.mf.dispatchFetch('http://localhost/api/calendar/google/eligibility', { headers: auth });
    assert.equal(eligibleOther.status, 200);
    assert.equal((await eligibleOther.json()).eligible, false);
    for (const [path, method] of [
      ['/api/calendar/google/status', 'GET'],
      ['/api/calendar/google/connect', 'POST'],
      ['/api/calendar/google/calendars', 'GET'],
      ['/api/calendar/google/select', 'POST'],
      ['/api/calendar/google/sync', 'POST'],
      ['/api/calendar/google/disconnect', 'POST'],
    ]) {
      const res = await runtime.mf.dispatchFetch('http://localhost' + path, { method, headers: auth });
      assert.equal(res.status, 403, method + ' ' + path);
      assert.equal((await res.json()).error, 'calendar_tester_not_authorized');
    }

    // The runtime resolves the verified SaaS account from D1, not the JWT email claim.
    await runtime.db.prepare('UPDATE auth_users SET email=? WHERE user_id=?')
      .bind('d.moreira.garcia9393@gmail.com', userId).run();
    const debora = await runtime.login('d.moreira.garcia9393@gmail.com');
    const authDebora = { Authorization: 'Bearer ' + debora.access_token };
    const eligibility = await runtime.mf.dispatchFetch('http://localhost/api/calendar/google/eligibility', { headers: authDebora });
    assert.equal(eligibility.status, 200);
    assert.deepEqual(await eligibility.json(), { eligible: true, configured: true });
    const status = await runtime.mf.dispatchFetch('http://localhost/api/calendar/google/status', { headers: authDebora });
    assert.equal(status.status, 200);
    assert.equal((await status.json()).connected, false);
    const connect = await runtime.mf.dispatchFetch('http://localhost/api/calendar/google/connect', { method: 'POST', headers: authDebora });
    assert.equal(connect.status, 200);
    const link = new URL((await connect.json()).authorization_url);
    assert.equal(link.hostname, 'accounts.google.com');
    assert.match(link.searchParams.get('scope'), /calendar\.events/);
    assert.ok(link.searchParams.get('state')?.length > 30);
    const savedStates = await runtime.db.prepare('SELECT COUNT(*) AS n FROM calendar_google_oauth_states WHERE owner_id=?')
      .bind(userId).first();
    assert.equal(Number(savedStates.n), 1);
    const apple = await runtime.mf.dispatchFetch('http://localhost/api/calendar/apple/status', { headers: authDebora });
    assert.equal(apple.status, 403); // Google pilot alone does not grant the paid Apple feature.
  } finally { await runtime.close(); }
});
