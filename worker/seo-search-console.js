import { createGoogleRefreshTokenProvider } from './vendor/artisys-seo/google-token.mjs';
import { createSearchConsoleClient } from './vendor/artisys-seo/search-console.mjs';
import { loadSearchConsoleOverview } from './vendor/artisys-seo/search-console-overview.mjs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseSeoAllowedUserIds(value) {
  return new Set(text(value).split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean));
}

function googleConfig(env) {
  const clientId = text(env?.ARTISYS_GOOGLE_CLIENT_ID);
  const clientSecret = text(env?.ARTISYS_GOOGLE_CLIENT_SECRET);
  const refreshToken = text(env?.ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultPeriod(now = new Date()) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 27);
  return { startDate: isoDate(start), endDate: isoDate(end) };
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function resolvePeriod(request, now) {
  const url = new URL(request.url);
  const startParam = text(url.searchParams.get('startDate'));
  const endParam = text(url.searchParams.get('endDate'));
  if (!startParam && !endParam) return defaultPeriod(now);
  if (!startParam || !endParam || !validIsoDate(startParam) || !validIsoDate(endParam) || startParam > endParam) {
    throw new RangeError('invalid_period');
  }
  return { startDate: startParam, endDate: endParam };
}

export async function handleSeoGoogleOverview(request, env, dependencies = {}) {
  const authenticateUser = dependencies.authenticateUser;
  if (typeof authenticateUser !== 'function') return json(500, { error: 'seo_auth_dependency_missing' });

  const user = await authenticateUser(request);
  if (!user?.id) return json(401, { error: 'unauthorized' });

  const allowedUserIds = parseSeoAllowedUserIds(env?.ARTISYS_SEO_ALLOWED_USER_IDS);
  if (allowedUserIds.size === 0) return json(503, { error: 'seo_admin_not_configured' });
  if (!allowedUserIds.has(String(user.id))) return json(403, { error: 'forbidden' });

  const config = googleConfig(env);
  if (!config) return json(503, { error: 'seo_google_not_configured' });

  let period;
  try {
    period = resolvePeriod(request, dependencies.now ? new Date(dependencies.now()) : new Date());
  } catch {
    return json(400, { error: 'invalid_period' });
  }

  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return json(500, { error: 'seo_fetch_unavailable' });

  try {
    const getAccessToken = createGoogleRefreshTokenProvider({
      ...config,
      fetch: fetchImpl,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    const client = createSearchConsoleClient({ getAccessToken, fetch: fetchImpl });
    const googleSearch = await loadSearchConsoleOverview({
      client,
      siteUrl: text(env?.ARTISYS_SEO_SITE_URL) || 'deboralactacao.com',
      ...period,
      rowLimit: 10,
    });
    return json(200, { ok: true, googleSearch });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error?.status) ? error.status : undefined;
    return json(502, {
      error: 'search_console_unavailable',
      ...(upstreamStatus ? { upstreamStatus } : {}),
    });
  }
}
