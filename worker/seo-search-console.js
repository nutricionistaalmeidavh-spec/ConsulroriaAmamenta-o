import { createGoogleRefreshTokenProvider } from './vendor/artisys-seo/google-token.mjs';
import { createSearchConsoleClient } from './vendor/artisys-seo/search-console.mjs';
import { loadSearchConsoleOverview } from './vendor/artisys-seo/search-console-overview.mjs';

const DEFAULT_SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const DEFAULT_SEO_ADMIN_EMAIL = 'nutricionistaalmeidavh@gmail.com';

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

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function constantTimeTextEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

function googleConfig(env) {
  const clientId = text(env?.ARTISYS_GOOGLE_CLIENT_ID);
  const clientSecret = text(env?.ARTISYS_GOOGLE_CLIENT_SECRET);
  const refreshToken = text(env?.ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function supabaseAuthConfig(env) {
  return {
    url: text(env?.ARTISYS_SUPABASE_URL) || DEFAULT_SUPABASE_URL,
    publishableKey: text(env?.ARTISYS_SUPABASE_PUBLISHABLE_KEY) || DEFAULT_SUPABASE_PUBLISHABLE_KEY,
    adminEmail: (text(env?.ARTISYS_SEO_ADMIN_EMAIL) || DEFAULT_SEO_ADMIN_EMAIL).toLowerCase(),
  };
}

function hasGoogleIdentity(user) {
  const primary = text(user?.app_metadata?.provider).toLowerCase();
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return primary === 'google'
    || providers.some((provider) => String(provider).toLowerCase() === 'google')
    || identities.some((identity) => String(identity?.provider || '').toLowerCase() === 'google');
}

async function authorizeSeoRequest(request, env, fetchImpl) {
  const presentedToken = bearerToken(request);
  if (!presentedToken) return { ok: false, response: json(401, { error: 'unauthorized' }) };

  const configuredAdminToken = text(env?.ARTISYS_SEO_ADMIN_TOKEN);
  if (configuredAdminToken && constantTimeTextEqual(presentedToken, configuredAdminToken)) {
    return { ok: true, method: 'admin_token' };
  }

  const auth = supabaseAuthConfig(env);
  let response;
  try {
    response = await fetchImpl(`${auth.url}/auth/v1/user`, {
      headers: {
        apikey: auth.publishableKey,
        authorization: `Bearer ${presentedToken}`,
      },
    });
  } catch {
    return { ok: false, response: json(403, { error: 'forbidden' }) };
  }

  if (!response.ok) return { ok: false, response: json(403, { error: 'forbidden' }) };

  let user;
  try {
    user = await response.json();
  } catch {
    return { ok: false, response: json(403, { error: 'forbidden' }) };
  }

  const email = text(user?.email).toLowerCase();
  if (email !== auth.adminEmail || !hasGoogleIdentity(user)) {
    return { ok: false, response: json(403, { error: 'forbidden' }) };
  }

  return { ok: true, method: 'google_oauth', email };
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

function opportunityBase(row) {
  return {
    clicks: Number(row?.clicks || 0),
    impressions: Number(row?.impressions || 0),
    ctr: Number(row?.ctr || 0),
    position: Number.isFinite(row?.position) ? row.position : null,
  };
}

export function buildSearchConsoleAudit(googleSearch) {
  const opportunities = [];
  const queries = Array.isArray(googleSearch?.topQueries) ? googleSearch.topQueries : [];
  const pages = Array.isArray(googleSearch?.topPages) ? googleSearch.topPages : [];

  for (const row of queries) {
    if (row.impressions >= 50 && row.ctr < 0.025) {
      opportunities.push({
        type: 'low_ctr_query',
        priority: row.impressions >= 150 ? 'high' : 'medium',
        label: 'CTR baixo',
        title: `Melhorar clique para “${row.query}”`,
        recommendation: 'Revisar título e descrição da página para responder melhor à intenção desta busca, sem alterar o conteúdo clínico sem aprovação.',
        query: row.query,
        ...opportunityBase(row),
      });
    }
    if (row.impressions >= 30 && row.position >= 4 && row.position <= 20) {
      opportunities.push({
        type: 'ranking_opportunity',
        priority: row.position <= 10 ? 'high' : 'medium',
        label: 'Perto da 1ª página',
        title: `Ganhar posição para “${row.query}”`,
        recommendation: 'Reforçar a relevância semântica da landing para esta intenção e acompanhar a evolução da posição média.',
        query: row.query,
        ...opportunityBase(row),
      });
    }
  }

  for (const row of pages) {
    if (row.impressions >= 100 && row.ctr < 0.025) {
      opportunities.push({
        type: 'low_ctr_page',
        priority: row.impressions >= 300 ? 'high' : 'medium',
        label: 'Página com CTR baixo',
        title: 'Melhorar apresentação da página no Google',
        recommendation: 'Reavaliar title, description e alinhamento com as buscas que geram impressões para esta página.',
        page: row.page,
        ...opportunityBase(row),
      });
    }
  }

  opportunities.sort((left, right) => {
    const priority = { high: 2, medium: 1 };
    return (priority[right.priority] - priority[left.priority]) || (right.impressions - left.impressions);
  });

  return Object.freeze({
    summary: Object.freeze({
      opportunityCount: opportunities.length,
      highPriorityCount: opportunities.filter((item) => item.priority === 'high').length,
      queryCount: queries.length,
      pageCount: pages.length,
    }),
    opportunities: Object.freeze(opportunities.slice(0, 12).map((item) => Object.freeze(item))),
  });
}

export async function handleSeoGoogleOverview(request, env, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return json(500, { error: 'seo_fetch_unavailable' });

  const authorization = await authorizeSeoRequest(request, env, fetchImpl);
  if (!authorization.ok) return authorization.response;

  const config = googleConfig(env);
  if (!config) return json(503, { error: 'seo_google_not_configured' });

  let period;
  try {
    period = resolvePeriod(request, dependencies.now ? new Date(dependencies.now()) : new Date());
  } catch {
    return json(400, { error: 'invalid_period' });
  }

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
    const audit = buildSearchConsoleAudit(googleSearch);
    return json(200, { ok: true, googleSearch, audit });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error?.status) ? error.status : undefined;
    return json(502, {
      error: 'search_console_unavailable',
      ...(upstreamStatus ? { upstreamStatus } : {}),
    });
  }
}
