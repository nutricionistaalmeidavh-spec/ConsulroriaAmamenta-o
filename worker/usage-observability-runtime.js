import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { recordUsageHeartbeat, closeUsageSession } from './usage-presence-service.js';
import { observabilitySummary, listObservedUsers, listObservedSales, listUserSessions } from './usage-observability-queries.js';

const enc = new TextEncoder();
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(String(value || ''))));
}
async function sameSecret(left, right) {
  if (!left || !right) return false;
  const [a,b] = await Promise.all([digest(left), digest(right)]);
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}
function queryObject(url) { return Object.fromEntries(url.searchParams.entries()); }

export async function handleUsageObservabilityRuntime(request, env, url = new URL(request.url)) {
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const user = await authenticateClinicalRequest(request, env).catch(() => null);
    if (user?.id) {
      try { await closeUsageSession(env, user.id); }
      catch (error) { console.error('usage session close failed', error); }
    }
    return null;
  }

  if (url.pathname === '/api/presence/heartbeat') {
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return json(401, { error: 'unauthorized' });
    try {
      const state = await recordUsageHeartbeat(env, user.id);
      return json(200, { ok: true, online: true, lastSeenAt: state.lastSeenAt, sessionId: state.sessionId });
    } catch (error) {
      console.error('usage heartbeat failed', error);
      return json(503, { error: 'usage_observability_unavailable' });
    }
  }

  if (!url.pathname.startsWith('/api/internal/observability/')) return null;
  if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });
  if (!await sameSecret(
    request.headers.get('x-debora-observability-secret') || '',
    String(env.DEBORA_OBSERVABILITY_SECRET || ''),
  )) return json(401, { error: 'unauthorized' });

  try {
    if (url.pathname === '/api/internal/observability/summary') return json(200, await observabilitySummary(env));
    if (url.pathname === '/api/internal/observability/users') return json(200, await listObservedUsers(env, queryObject(url)));
    if (url.pathname === '/api/internal/observability/sales') return json(200, await listObservedSales(env, queryObject(url)));
    const match = url.pathname.match(/^\/api\/internal\/observability\/users\/([^/]+)\/sessions$/);
    if (match) return json(200, await listUserSessions(env, decodeURIComponent(match[1]), queryObject(url)));
    return json(404, { error: 'not_found' });
  } catch (error) {
    if (['invalid_cursor','invalid_user_id'].includes(String(error?.message || ''))) {
      return json(400, { error: String(error.message) });
    }
    console.error('internal observability failed', error);
    return json(503, { error: 'usage_observability_unavailable' });
  }
}
