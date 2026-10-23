import test from 'node:test';
import assert from 'node:assert/strict';
import { appointmentToEvent, appointmentsToIcs, googleAuthorizeUrl, googleEventId } from '../worker/calendar-integration.js';

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
