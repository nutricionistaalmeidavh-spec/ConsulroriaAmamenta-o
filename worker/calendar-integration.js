import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';

// Calendar integrations are owner-scoped and are deliberately independent of the clinical record format.
const enc = new TextEncoder();
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function fail(code, status = 400) { return json(status, { error: code }); }
function toUtc(date) { return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function validDate(date) { return date && !Number.isNaN(new Date(date).getTime()); }
function durationMs(item) {
  const minutes = Number(item?.duration_min);
  return (Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : 60) * 60000;
}
function isCancelled(item) { return /^(cancelad[oa]|exclu[ií]d[oa])$/i.test(String(item?.status || '')); }
function validAppointment(item) { return Boolean(item?.id && validDate(item?.starts_at) && !isCancelled(item)); }

export function appointmentToEvent(item) {
  if (!validAppointment(item)) return null;
  const start = new Date(item.starts_at);
  return {
    summary: 'Atendimento - Gestão Amamentação',
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + durationMs(item)).toISOString() },
    visibility: 'private',
    transparency: 'opaque',
    description: 'Compromisso sincronizado pelo Gestão Amamentação. Consulte os detalhes clínicos somente no sistema.',
    reminders: { useDefault: true },
  };
}
export function appointmentsToIcs(items, ownerId) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gestao Amamentacao//Agenda//PT-BR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
  ];
  const now = toUtc(new Date());
  for (const item of items) {
    if (!validAppointment(item)) continue;
    const start = new Date(item.starts_at);
    const uid = String(item.id).replace(/[^A-Za-z0-9-]/g, '-').slice(0, 100);
    lines.push('BEGIN:VEVENT', 'UID:' + uid + '@gestao-amamentacao',
      'DTSTAMP:' + now, 'DTSTART:' + toUtc(start),
      'DTEND:' + toUtc(new Date(start.getTime() + durationMs(item))),
      'SUMMARY:Atendimento - Gestao Amamentacao', 'CLASS:PRIVATE',
      'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
export async function googleEventId(ownerId, appointmentId) {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode('gestao-calendar:' + ownerId + ':' + appointmentId));
  return [...new Uint8Array(hash)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
export function googleAuthorizeUrl(clientId, redirectUri, state) {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri,
    state, scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent',
  }).toString();
  return u.toString();
}
function urlIsSafeRedirect(env, request) {
  try {
    const expected = new URL(String(env.GOOGLE_CALENDAR_REDIRECT_URI || ''));
    const actual = new URL(request.url);
    return expected.protocol === 'https:' &&
      actual.protocol === 'https:' && expected.origin === actual.origin &&
      expected.pathname === '/api/calendar/google/callback';
  } catch { return false; }
}
function configured(env) {
  return Boolean(env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    env.GOOGLE_CALENDAR_REDIRECT_URI && /^[a-fA-F0-9]{64}$/.test(String(env.GOOGLE_CALENDAR_TOKEN_KEY || '')));
}
function keyMaterial(env) {
  if (!configured(env)) throw new Error('google_calendar_not_configured');
  return Uint8Array.from(String(env.GOOGLE_CALENDAR_TOKEN_KEY).match(/../g), x => parseInt(x, 16));
}
function b64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')), c => c.charCodeAt(0));
}
async function sha256(value) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
}
async function cryptKey(env) {
  return crypto.subtle.importKey('raw', keyMaterial(env), 'AES-GCM', false, ['encrypt','decrypt']);
}
async function encryptTokens(env, ownerId, tokens) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const bytes = enc.encode(JSON.stringify(tokens));
  const ciphertext = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv: nonce, additionalData: enc.encode(ownerId),
  }, await cryptKey(env), bytes);
  return b64(new Uint8Array([...nonce, ...new Uint8Array(ciphertext)]));
}
async function decryptTokens(env, ownerId, encrypted) {
  const packed = unb64(encrypted);
  const plain = await crypto.subtle.decrypt({
    name: 'AES-GCM', iv: packed.slice(0, 12), additionalData: enc.encode(ownerId),
  }, await cryptKey(env), packed.slice(12));
  return JSON.parse(new TextDecoder().decode(plain));
}
function oauthRedirect(request) {
  const url = new URL(request.url);
  url.pathname = '/';
  url.search = '';
  url.hash = '/settings';
  return Response.redirect(url.toString(), 303);
}
function googleError(response) {
  const error = new Error('google_calendar_provider_error');
  error.status = response.status;
  return error;
}
async function googleToken(env, form) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CALENDAR_CLIENT_ID,
      client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET, ...form,
    }),
  });
  if (!response.ok) throw googleError(response);
  return response.json();
}
async function connection(db, ownerId) {
  return db.prepare('SELECT owner_id, tokens_cipher, calendar_id FROM calendar_google_connections WHERE owner_id=?')
    .bind(ownerId).first();
}
async function accessToken(env, ownerId, row) {
  const tokens = await decryptTokens(env, ownerId, row.tokens_cipher);
  if (tokens.access_token && Number(tokens.expires_at) > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('google_calendar_reconnect_required');
  const fresh = await googleToken(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
  const updated = {
    refresh_token: fresh.refresh_token || tokens.refresh_token,
    access_token: fresh.access_token, expires_at: Date.now() + Number(fresh.expires_in || 3500) * 1000,
  };
  const ciphertext = await encryptTokens(env, ownerId, updated);
  await env.CLINICAL_DB.prepare('UPDATE calendar_google_connections SET tokens_cipher=?,updated_at=? WHERE owner_id=?')
    .bind(ciphertext, new Date().toISOString(), ownerId).run();
  // Reuse the refreshed token throughout this synchronization batch.
  row.tokens_cipher = ciphertext;
  return updated.access_token;
}
async function googleApi(env, ownerId, conn, path, { method = 'GET', body } = {}) {
  const token = await accessToken(env, ownerId, conn);
  const response = await fetch(CALENDAR_API + path, {
    method, headers: {
      Authorization: 'Bearer ' + token, Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) return { status: response.status, data: null };
  return { status: response.status, data: response.status === 204 ? null : await response.json() };
}
export async function appointmentRows(env, ownerId, limit = 500) {
  const query = await env.CLINICAL_DB.prepare(
    'SELECT record_json FROM supabase_records WHERE table_name=? AND (owner_id=? OR (owner_id IS NULL AND json_extract(record_json,\'$.owner_id\')=?)) LIMIT ?',
  ).bind('appointments', ownerId, ownerId, limit).all();
  return (query.results || []).flatMap(row => {
    try { return [JSON.parse(row.record_json)]; } catch { return []; }
  });
}
async function selectedCalendar(env, ownerId, conn, calendarId) {
  let pageToken = '';
  do {
    const u = new URL('/calendar/v3/users/me/calendarList', 'https://www.googleapis.com');
    u.searchParams.set('maxResults', '250');
    if (pageToken) u.searchParams.set('pageToken', pageToken);
    const path = u.pathname.replace('/calendar/v3', '') + u.search;
    const result = await googleApi(env, ownerId, conn, path);
    if (result.status !== 200) throw new Error('google_calendar_list_failed');
    const match = (result.data.items || []).find(item =>
      item.id === calendarId && ['writer', 'owner'].includes(item.accessRole));
    if (match) return match;
    pageToken = result.data.nextPageToken || '';
  } while (pageToken);
  return null;
}
async function linkedEvent(env, ownerId, appointmentId) {
  return env.CLINICAL_DB.prepare('SELECT calendar_id,event_id FROM calendar_google_events WHERE owner_id=? AND appointment_id=?')
    .bind(ownerId, appointmentId).first();
}
async function removeEvent(env, ownerId, conn, calendarId, eventId) {
  const result = await googleApi(env, ownerId, conn,
    '/calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId),
    { method: 'DELETE' });
  if (![204, 200, 404, 410].includes(result.status)) throw new Error('google_calendar_delete_failed');
}
export async function syncCalendarAppointment(env, ownerId, appointmentId) {
  if (!configured(env) || !env.CLINICAL_DB || !ownerId || !appointmentId) return { skipped: true };
  const conn = await connection(env.CLINICAL_DB, ownerId);
  if (!conn?.calendar_id) return { skipped: true };
  const linked = await linkedEvent(env, ownerId, appointmentId);
  const row = await env.CLINICAL_DB.prepare(
    'SELECT record_json FROM supabase_records WHERE table_name=? AND (owner_id=? OR (owner_id IS NULL AND json_extract(record_json,\'$.owner_id\')=?)) AND json_extract(record_json,\'$.id\')=? LIMIT 1',
  ).bind('appointments', ownerId, ownerId, appointmentId).first();
  const item = row?.record_json ? JSON.parse(row.record_json) : null;
  if (linked && (linked.calendar_id !== conn.calendar_id || !validAppointment(item))) {
    await removeEvent(env, ownerId, conn, linked.calendar_id, linked.event_id);
    await env.CLINICAL_DB.prepare('DELETE FROM calendar_google_events WHERE owner_id=? AND appointment_id=?')
      .bind(ownerId, appointmentId).run();
  }
  if (!validAppointment(item)) return { deleted: Boolean(linked) };
  const eventId = await googleEventId(ownerId, appointmentId);
  const path = '/calendars/' + encodeURIComponent(conn.calendar_id) + '/events';
  const event = { ...appointmentToEvent(item), id: eventId };
  const edited = await googleApi(env, ownerId, conn, path + '/' + eventId, { method: 'PATCH', body: appointmentToEvent(item) });
  if (edited.status === 404) {
    const created = await googleApi(env, ownerId, conn, path, { method: 'POST', body: event });
    if (created.status === 409) {
      const retry = await googleApi(env, ownerId, conn, path + '/' + eventId, { method: 'PATCH', body: appointmentToEvent(item) });
      if (retry.status !== 200) throw new Error('google_calendar_upsert_failed');
    } else if (created.status !== 200 && created.status !== 201) {
      throw new Error('google_calendar_create_failed');
    }
  } else if (edited.status !== 200) {
    throw new Error('google_calendar_update_failed');
  }
  await env.CLINICAL_DB.prepare(
    'INSERT INTO calendar_google_events(owner_id,appointment_id,calendar_id,event_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,appointment_id) DO UPDATE SET calendar_id=excluded.calendar_id,event_id=excluded.event_id,updated_at=excluded.updated_at',
  ).bind(ownerId, appointmentId, conn.calendar_id, eventId, new Date().toISOString()).run();
  return { synced: true };
}
async function syncAll(env, ownerId) {
  const rows = await appointmentRows(env, ownerId);
  const ids = new Set(rows.filter(row => row.id).map(row => row.id));
  const stored = await env.CLINICAL_DB.prepare('SELECT appointment_id FROM calendar_google_events WHERE owner_id=?').bind(ownerId).all();
  for (const record of stored.results || []) ids.add(record.appointment_id);
  let synced = 0;
  for (const id of ids) {
    await syncCalendarAppointment(env, ownerId, id);
    synced++;
  }
  return synced;
}
async function handleCallback(request, env, url) {
  if (!configured(env) || !urlIsSafeRedirect(env, request)) return fail('google_calendar_not_configured', 503);
  if (url.searchParams.has('error')) return oauthRedirect(request);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  if (!code || !/^[A-Za-z0-9_-]{32,128}$/.test(state)) return fail('invalid_calendar_oauth_callback', 400);
  const hash = await sha256(state);
  const issued = await env.CLINICAL_DB.prepare('SELECT owner_id,expires_at FROM calendar_google_oauth_states WHERE state_hash=?')
    .bind(hash).first();
  if (!issued || Number(issued.expires_at) < Date.now()) return fail('expired_calendar_oauth_state', 400);
  const consumed = await env.CLINICAL_DB.prepare('DELETE FROM calendar_google_oauth_states WHERE state_hash=? AND expires_at>?')
    .bind(hash, Date.now()).run();
  if (Number(consumed.meta?.changes) !== 1) return fail('calendar_oauth_state_already_used', 400);
  const result = await googleToken(env, {
    grant_type: 'authorization_code', code, redirect_uri: env.GOOGLE_CALENDAR_REDIRECT_URI,
  });
  const previous = await connection(env.CLINICAL_DB, issued.owner_id);
  const previousTokens = previous?.tokens_cipher
    ? await decryptTokens(env, issued.owner_id, previous.tokens_cipher) : null;
  const tokens = {
    refresh_token: result.refresh_token || previousTokens?.refresh_token,
    access_token: result.access_token,
    expires_at: Date.now() + Number(result.expires_in || 3500) * 1000,
  };
  if (!tokens.refresh_token) return fail('google_calendar_refresh_token_missing', 409);
  const cipher = await encryptTokens(env, issued.owner_id, tokens);
  await env.CLINICAL_DB.prepare(
    'INSERT INTO calendar_google_connections(owner_id,tokens_cipher,calendar_id,updated_at) VALUES(?,?,NULL,?) ON CONFLICT(owner_id) DO UPDATE SET tokens_cipher=excluded.tokens_cipher,calendar_id=NULL,updated_at=excluded.updated_at',
  ).bind(issued.owner_id, cipher, new Date().toISOString()).run();
  return oauthRedirect(request);
}
export async function handleCalendarIntegration(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/api/calendar/')) return null;
  if (!env.CLINICAL_DB) return fail('cloudflare_d1_required', 503);
  try {
    if (url.pathname === '/api/calendar/google/callback' && request.method === 'GET') {
      return await handleCallback(request, env, url);
    }
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return fail('cloudflare_auth_required', 401);
    const ownerId = user.id;
    if (url.pathname === '/api/calendar/appointments.ics' && request.method === 'GET') {
      const items = await appointmentRows(env, ownerId, 2000);
      return new Response(appointmentsToIcs(items, ownerId), {
        headers: {
          'content-type': 'text/calendar; charset=utf-8',
          'content-disposition': 'attachment; filename="agenda-gestao-amamentacao.ics"',
          'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
        },
      });
    }
    if (url.pathname === '/api/calendar/google/status' && request.method === 'GET') {
      if (!configured(env)) return json(200, { configured: false, connected: false });
      const conn = await connection(env.CLINICAL_DB, ownerId);
      return json(200, { configured: true, connected: Boolean(conn), calendar_id: conn?.calendar_id || null });
    }
    if (!configured(env)) return fail('google_calendar_not_configured', 503);
    if (url.pathname === '/api/calendar/google/connect' && request.method === 'POST') {
      const nonce = b64(crypto.getRandomValues(new Uint8Array(32)));
      const stateHash = await sha256(nonce);
      await env.CLINICAL_DB.prepare('INSERT INTO calendar_google_oauth_states(state_hash,owner_id,expires_at) VALUES(?,?,?)')
        .bind(stateHash, ownerId, Date.now() + 10 * 60 * 1000).run();
      return json(200, { authorization_url: googleAuthorizeUrl(
        env.GOOGLE_CALENDAR_CLIENT_ID, env.GOOGLE_CALENDAR_REDIRECT_URI, nonce,
      ) });
    }
    const conn = await connection(env.CLINICAL_DB, ownerId);
    if (!conn) return fail('google_calendar_not_connected', 409);
    if (url.pathname === '/api/calendar/google/calendars' && request.method === 'GET') {
      const result = await googleApi(env, ownerId, conn, '/users/me/calendarList?maxResults=250');
      if (result.status !== 200) return fail('google_calendar_provider_error', 502);
      return json(200, { calendars: (result.data.items || []).filter(item =>
        ['writer', 'owner'].includes(item.accessRole)).map(item => ({
        id: item.id, summary: item.summary, primary: Boolean(item.primary),
      })) });
    }
    if (url.pathname === '/api/calendar/google/select' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const id = String(body.calendar_id || '').trim();
      if (!id || id.length > 300) return fail('invalid_calendar_id');
      const selected = await selectedCalendar(env, ownerId, conn, id);
      if (!selected) return fail('calendar_not_writable', 403);
      await env.CLINICAL_DB.prepare('UPDATE calendar_google_connections SET calendar_id=?,updated_at=? WHERE owner_id=?')
        .bind(id, new Date().toISOString(), ownerId).run();
      return json(200, { calendar_id: id, selected: true });
    }
    if (url.pathname === '/api/calendar/google/sync' && request.method === 'POST') {
      if (!conn.calendar_id) return fail('google_calendar_selection_required', 409);
      const synced = await syncAll(env, ownerId);
      return json(200, { synced });
    }
    if (url.pathname === '/api/calendar/google/disconnect' && request.method === 'POST') {
      // Delete remotely created events before removing credentials; stop on failure to avoid orphaned PHI.
      const linked = await env.CLINICAL_DB.prepare('SELECT calendar_id,event_id FROM calendar_google_events WHERE owner_id=?').bind(ownerId).all();
      for (const item of linked.results || []) await removeEvent(env, ownerId, conn, item.calendar_id, item.event_id);
      await env.CLINICAL_DB.prepare('DELETE FROM calendar_google_events WHERE owner_id=?').bind(ownerId).run();
      await env.CLINICAL_DB.prepare('DELETE FROM calendar_google_connections WHERE owner_id=?').bind(ownerId).run();
      return json(200, { disconnected: true });
    }
    return fail('not_found', 404);
  } catch (error) {
    // Never log access tokens, authorization codes, patient names or external provider bodies.
    console.error('calendar integration error', String(error?.message || 'unknown'));
    return fail(
      error?.message === 'google_calendar_reconnect_required' ? 'google_calendar_reconnect_required'
      : error?.message === 'google_calendar_not_configured' ? 'google_calendar_not_configured'
      : 'calendar_integration_unavailable', 503,
    );
  }
}

// Keep existing clinic CRUD canonical. Sync only after a successful clinical write; never gate saves on Google.
export function isCalendarMutation(request, url = new URL(request.url)) {
  return (url.pathname === '/api/clinical/rpc/schedule_clinical_appointment' && request.method === 'POST') ||
    (url.pathname === '/api/clinical/rpc/delete_scheduled_appointment' && request.method === 'POST') ||
    (url.pathname === '/api/clinical/records/appointments' && ['POST','PATCH','DELETE'].includes(request.method));
}
export async function observeCalendarMutation(response, requestCopy, env, ctx) {
  if (!response?.ok || !requestCopy || typeof ctx?.waitUntil !== 'function') return response;
  const url = new URL(requestCopy.url);
  if (!isCalendarMutation(requestCopy, url)) return response;
  try {
    const user = await authenticateClinicalRequest(requestCopy, env);
    if (!user?.id) return response;
    let id = '';
    if (url.pathname.endsWith('/schedule_clinical_appointment')) {
      const result = await response.clone().json();
      id = String(result?.id || '');
    } else if (url.pathname.endsWith('/delete_scheduled_appointment')) {
      const body = await requestCopy.json();
      id = String(body?.p_appointment_id || '');
    } else if (requestCopy.method === 'POST') {
      const result = await response.clone().json();
      id = String(Array.isArray(result) ? result[0]?.id : result?.id || '');
    } else {
      const filter = url.searchParams.get('id') || '';
      if (filter.startsWith('eq.')) id = filter.slice(3);
    }
    if (id) ctx.waitUntil(syncCalendarAppointment(env, user.id, id).catch(err => {
      console.error('calendar background sync failed', String(err?.message || 'unknown'));
    }));
  } catch {
    // A third-party calendar must never break clinical writes.
  }
  return response;
}
