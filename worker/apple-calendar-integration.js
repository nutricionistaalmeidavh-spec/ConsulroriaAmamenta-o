import { calendarEventTitlesForOwner } from './calendar-event-display.js';
import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { appleAppointmentRows, appointmentsToIcs } from './apple-calendar-ics.js';

// An Apple Calendar subscription is a read-only HTTPS ICS feed, NOT an iCloud CalDAV
// connection. The bearer URL contains a strong random token; D1 stores only its hash.
const ORIGIN = 'https://deboralactacao.com';
const FEED_PATTERN = /^\/api\/calendar\/apple\/feed\/([a-f0-9]{64})\.ics$/;
const decoder = new TextEncoder();

function response(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}

function hex(buffer) {
  return Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function createAppleFeedToken() {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digestAppleFeedToken(token) {
  return hex(await crypto.subtle.digest('SHA-256', decoder.encode(token)));
}

export function appleSubscriptionUrl(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token))) throw new Error('invalid_apple_feed_token');
  return ORIGIN + '/api/calendar/apple/feed/' + token + '.ics';
}

function calendarResponse(body, head = false) {
  return new Response(head ? null : body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="gestao-amamentacao-apple.ics"',
      'cache-control': 'private, no-store, max-age=0',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function feedResponse(request, env, token) {
  const digest = await digestAppleFeedToken(token);
  const row = await env.CLINICAL_DB.prepare(
    'SELECT owner_id FROM calendar_apple_feeds WHERE token_hash=? LIMIT 1',
  ).bind(digest).first();
  if (!row?.owner_id) return response(404, { error: 'calendar_feed_not_found' });
  if (request.method === 'HEAD') return calendarResponse(null, true);
  // Resolve ownership on D1, not from any user-supplied ID. No patient details
  // or other tenant's appointments are ever included in this anonymous feed.
  const rows = await appleAppointmentRows(env, row.owner_id, 2000);
  const body = appointmentsToIcs(rows, row.owner_id)
    .replace('CALSCALE:GREGORIAN\r\n', 'CALSCALE:GREGORIAN\r\nX-WR-CALNAME:Gestao Amamentacao - Agenda\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n');
  return calendarResponse(body);
}

export async function handleAppleCalendarIntegration(request, env, url = new URL(request.url)) {
  if (!url.pathname.startsWith('/api/calendar/apple/')) return null;
  if (!env.CLINICAL_DB) return response(503, { error: 'cloudflare_d1_required' });
  try {
    // Apple Calendar fetches the subscription independently of the app session.
    // A bearer token is unavoidable for unattended read-only ICS subscriptions.
    if (url.pathname.startsWith('/api/calendar/apple/feed/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return response(405, { error: 'method_not_allowed' });
      const match = FEED_PATTERN.exec(url.pathname);
      if (!match) return response(404, { error: 'calendar_feed_not_found' });
      return await feedResponse(request, env, match[1]);
    }

    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return response(401, { error: 'cloudflare_auth_required' });

    // The Cloudflare Git deploy publishes Worker code and assets, not necessarily
    // the optional D1 schema. Provision the additive table on first authorized
    // access, keeping Apple functional without a manual post-deploy command.
    await env.CLINICAL_DB.prepare('CREATE TABLE IF NOT EXISTS calendar_apple_feeds (owner_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)').run();

    if (url.pathname === '/api/calendar/apple/status' && request.method === 'GET') {
      const row = await env.CLINICAL_DB.prepare(
        'SELECT created_at,updated_at FROM calendar_apple_feeds WHERE owner_id=? LIMIT 1',
      ).bind(user.id).first();
      return response(200, { active: Boolean(row), updated_at: row?.updated_at || null });
    }

    if (url.pathname === '/api/calendar/apple/create' && request.method === 'POST') {
      const token = createAppleFeedToken();
      const hash = await digestAppleFeedToken(token);
      const now = new Date().toISOString();
      await env.CLINICAL_DB.prepare(
        'INSERT INTO calendar_apple_feeds(owner_id,token_hash,created_at,updated_at) VALUES(?,?,?,?) ' +
        'ON CONFLICT(owner_id) DO UPDATE SET token_hash=excluded.token_hash, updated_at=excluded.updated_at',
      ).bind(user.id, hash, now, now).run();
      // Return only once; reissuing rotates and revokes the previous link.
      return response(200, {
        active: true,
        subscription_url: appleSubscriptionUrl(token),
        webcal_url: appleSubscriptionUrl(token).replace(/^https:/, 'webcal:'),
      });
    }

    if (url.pathname === '/api/calendar/apple/revoke' && request.method === 'POST') {
      await env.CLINICAL_DB.prepare(
        'DELETE FROM calendar_apple_feeds WHERE owner_id=?',
      ).bind(user.id).run();
      return response(200, { active: false, revoked: true });
    }

    return response(404, { error: 'not_found' });
  } catch (error) {
    // Deliberately never log feed tokens, URLs, patient details or auth headers.
    console.error('apple calendar subscription error', String(error?.name || 'error'));
    return response(503, { error: 'calendar_integration_unavailable' });
  }
}
