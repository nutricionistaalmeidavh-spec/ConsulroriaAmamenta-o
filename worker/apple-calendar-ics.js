// Independent, privacy-preserving iCalendar projection. No dependency on Google OAuth.
const limitMs = 24 * 60 * 60 * 1000;
const validDate = date => date && !Number.isNaN(new Date(date).getTime());
const toUtc = date => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const cancelled = item => /^(cancelad[oa]|exclu[ií]d[oa])$/i.test(String(item?.status || ''));
const included = item => Boolean(item?.id && validDate(item?.starts_at) && !cancelled(item));
const durationMs = item => {
  const minutes = Number(item?.duration_min);
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes * 60000 : 3600000;
};

import { escapeIcsText } from './calendar-event-display.js';

export function appointmentsToIcs(items, eventTitles = new Map()) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestao Amamentacao//Apple Calendar//PT-BR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Gestao Amamentacao - Agenda',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
  ];
  const now = toUtc(new Date());
  for (const item of items) {
    if (!included(item)) continue;
    const start = new Date(item.starts_at);
    const uid = String(item.id).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 100);
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@gestao-amamentacao',
      'DTSTAMP:' + now, 'DTSTART:' + toUtc(start),
      'DTEND:' + toUtc(new Date(start.getTime() + durationMs(item))),
      'SUMMARY:' + escapeIcsText(eventTitles.get(item.id) || 'Atendimento - Gestao Amamentacao'), 'CLASS:PRIVATE',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export async function appleAppointmentRows(env, ownerId, limit = 2000) {
  if (!ownerId || !env?.CLINICAL_DB) return [];
  const query = await env.CLINICAL_DB.prepare(
    'SELECT record_json FROM supabase_records WHERE table_name=? AND (owner_id=? OR (owner_id IS NULL AND json_extract(record_json,\'$.owner_id\')=?)) LIMIT ?',
  ).bind('appointments', ownerId, ownerId, limit).all();
  return (query.results || []).flatMap(row => {
    try { return [JSON.parse(row.record_json)]; } catch { return []; }
  });
}
