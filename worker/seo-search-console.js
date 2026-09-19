import { createGoogleRefreshTokenProvider } from './vendor/artisys-seo/google-token.mjs';
import { createSearchConsoleClient, normalizeSearchConsoleSiteUrl } from './vendor/artisys-seo/search-console.mjs';
import { loadSearchConsoleOverview } from './vendor/artisys-seo/search-console-overview.mjs';

const DEFAULT_SEO_ADMIN_EMAIL = 'nutricionistaalmeidavh@gmail.com';
const SEO_SESSION_COOKIE = 'artisys-seo-session';
const SEO_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ARTISYS_SITE = 'sc-domain:artisys.dev';
const LOJA_ONLINE_PRODUCT_PREFIX = 'https://artisys.dev/sistemas/loja-online/';

function json(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
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

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(rest.join('=')); } catch { return rest.join('='); }
    }
  }
  return '';
}

function constantTimeTextEqual(left, right) {
  const encoder = new TextEncoder();
  const a = encoder.encode(String(left));
  const b = encoder.encode(String(right));
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function stringToBase64Url(value) {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToString(value) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function nowMilliseconds(dependencies = {}) {
  const value = typeof dependencies.now === 'function' ? dependencies.now() : Date.now();
  if (value instanceof Date) return value.getTime();
  return Number(value);
}

function adminEmail(env) {
  return (text(env?.ARTISYS_SEO_ADMIN_EMAIL) || DEFAULT_SEO_ADMIN_EMAIL).toLowerCase();
}

function signingSecret(env) {
  return text(env?.ARTISYS_SEO_ADMIN_TOKEN);
}

function adminPassword(env) {
  return text(env?.ARTISYS_SEO_ADMIN_PASSWORD);
}

async function createSeoSessionToken(email, env, dependencies = {}) {
  const secret = signingSecret(env);
  if (!secret) return '';
  const expiresAt = nowMilliseconds(dependencies) + SEO_SESSION_MAX_AGE_SECONDS * 1000;
  const payload = stringToBase64Url(`${email.toLowerCase()}|${expiresAt}`);
  return `${payload}.${await hmac(secret, payload)}`;
}

async function verifySeoSessionToken(token, env, dependencies = {}) {
  const secret = signingSecret(env);
  if (!secret || !token) return false;
  const [payload, signature, extra] = String(token).split('.');
  if (!payload || !signature || extra !== undefined) return false;
  const expected = await hmac(secret, payload);
  if (!constantTimeTextEqual(signature, expected)) return false;
  let decoded;
  try { decoded = base64UrlToString(payload); } catch { return false; }
  const splitAt = decoded.lastIndexOf('|');
  if (splitAt < 1) return false;
  const email = decoded.slice(0, splitAt).toLowerCase();
  const expiresAt = Number(decoded.slice(splitAt + 1));
  return email === adminEmail(env) && Number.isFinite(expiresAt) && expiresAt > nowMilliseconds(dependencies);
}

function googleConfig(env) {
  const clientId = text(env?.ARTISYS_GOOGLE_CLIENT_ID);
  const clientSecret = text(env?.ARTISYS_GOOGLE_CLIENT_SECRET);
  const refreshToken = text(env?.ARTISYS_GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN);
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function seoContexts(env) {
  const deboraSite = normalizeSearchConsoleSiteUrl(text(env?.ARTISYS_SEO_SITE_URL) || 'deboralactacao.com');
  const artisysSite = normalizeSearchConsoleSiteUrl(text(env?.ARTISYS_SEO_ARTISYS_SITE_URL) || DEFAULT_ARTISYS_SITE);
  return Object.freeze([
    Object.freeze({
      id: 'debora',
      label: 'Débora Lactação',
      kind: 'product',
      siteUrl: deboraSite,
      pagePrefix: '',
    }),
    Object.freeze({
      id: 'loja-online',
      label: 'Loja Online — página comercial',
      kind: 'product',
      siteUrl: artisysSite,
      pagePrefix: text(env?.ARTISYS_SEO_LOJAONLINE_PAGE_PREFIX) || LOJA_ONLINE_PRODUCT_PREFIX,
    }),
  ]);
}

async function authorizeSeoRequest(request, env, dependencies = {}) {
  const configuredAdminToken = signingSecret(env);
  const presentedToken = bearerToken(request);
  if (configuredAdminToken && presentedToken && constantTimeTextEqual(presentedToken, configuredAdminToken)) {
    return { ok: true, method: 'admin_token' };
  }

  const sessionToken = cookieValue(request, SEO_SESSION_COOKIE);
  if (sessionToken && await verifySeoSessionToken(sessionToken, env, dependencies)) {
    return { ok: true, method: 'password', email: adminEmail(env) };
  }

  return { ok: false, response: json(401, { error: 'unauthorized' }) };
}

export async function handleSeoPasswordLogin(request, env, dependencies = {}) {
  if (!signingSecret(env)) return json(503, { error: 'seo_admin_not_configured' });
  const configuredPassword = adminPassword(env);
  if (!configuredPassword) return json(503, { error: 'seo_password_not_configured' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'invalid_request' }); }
  const email = text(body?.email).toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!constantTimeTextEqual(email, adminEmail(env)) || !constantTimeTextEqual(password, configuredPassword)) {
    return json(401, { error: 'invalid_credentials' });
  }

  const token = await createSeoSessionToken(email, env, dependencies);
  if (!token) return json(503, { error: 'seo_admin_not_configured' });
  const cookie = `${SEO_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SEO_SESSION_MAX_AGE_SECONDS}`;
  return json(200, { ok: true, email }, { 'set-cookie': cookie });
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
  if (!startParam || !endParam || !validIsoDate(startParam) || !validIsoDate(endParam) || startParam > endParam) throw new RangeError('invalid_period');
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
        type: 'low_ctr_query', priority: row.impressions >= 150 ? 'high' : 'medium', label: 'CTR baixo',
        title: `Melhorar clique para “${row.query}”`,
        recommendation: 'Revisar título e descrição da página para responder melhor à intenção desta busca, sem alterar o conteúdo do produto sem aprovação.',
        query: row.query, ...opportunityBase(row),
      });
    }
    if (row.impressions >= 30 && row.position >= 4 && row.position <= 20) {
      opportunities.push({
        type: 'ranking_opportunity', priority: row.position <= 10 ? 'high' : 'medium', label: 'Perto da 1ª página',
        title: `Ganhar posição para “${row.query}”`,
        recommendation: 'Reforçar a relevância semântica da página para esta intenção e acompanhar a evolução da posição média.',
        query: row.query, ...opportunityBase(row),
      });
    }
  }

  for (const row of pages) {
    if (row.impressions >= 100 && row.ctr < 0.025) {
      opportunities.push({
        type: 'low_ctr_page', priority: row.impressions >= 300 ? 'high' : 'medium', label: 'Página com CTR baixo',
        title: 'Melhorar apresentação da página no Google',
        recommendation: 'Reavaliar title, description e alinhamento com as buscas que geram impressões para esta página.',
        page: row.page, ...opportunityBase(row),
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

function createGoogleClient(config, fetchImpl, dependencies = {}) {
  const getAccessToken = createGoogleRefreshTokenProvider({
    ...config,
    fetch: fetchImpl,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  return createSearchConsoleClient({ getAccessToken, fetch: fetchImpl });
}

function normalizedSiteEntries(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  const output = [];
  for (const entry of entries) {
    try {
      const siteUrl = normalizeSearchConsoleSiteUrl(entry?.siteUrl);
      if (seen.has(siteUrl)) continue;
      seen.add(siteUrl);
      output.push({ siteUrl, permissionLevel: text(entry?.permissionLevel) || 'unknown' });
    } catch {
      // Ignore malformed upstream entries instead of surfacing them to the dashboard.
    }
  }
  return output;
}

function validPagePrefix(value) {
  const raw = text(value);
  if (!raw) return '';
  if (raw.length > 2048) throw new TypeError('pagePrefix too long');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new TypeError('pagePrefix must be a public HTTPS URL');
  return url.toString();
}

function pageFilterGroups(pagePrefix) {
  if (!pagePrefix) return undefined;
  return [{
    groupType: 'and',
    filters: [{ dimension: 'page', operator: 'contains', expression: pagePrefix }],
  }];
}

function siteAllowed(sites, siteUrl) {
  return sites.some((site) => site.siteUrl === siteUrl);
}

function resolveScope(request, env, sites) {
  const url = new URL(request.url);
  const requestedContext = text(url.searchParams.get('context'));
  const requestedSite = text(url.searchParams.get('siteUrl'));
  const requestedPrefix = text(url.searchParams.get('pagePrefix'));
  const contexts = seoContexts(env);

  if (requestedContext) {
    const context = contexts.find((item) => item.id === requestedContext);
    if (!context) return { error: 'seo_context_not_found' };
    if (!siteAllowed(sites, context.siteUrl)) return { error: 'seo_site_not_allowed' };
    return {
      context: context.id,
      label: context.label,
      kind: context.kind,
      siteUrl: context.siteUrl,
      pagePrefix: context.pagePrefix,
    };
  }

  if (requestedSite) {
    let siteUrl;
    let pagePrefix;
    try {
      siteUrl = normalizeSearchConsoleSiteUrl(requestedSite);
      pagePrefix = validPagePrefix(requestedPrefix);
    } catch {
      return { error: 'invalid_scope' };
    }
    if (!siteAllowed(sites, siteUrl)) return { error: 'seo_site_not_allowed' };
    return {
      context: 'custom',
      label: pagePrefix ? 'Loja / URL específica' : 'Domínio / propriedade',
      kind: pagePrefix ? 'store' : 'domain',
      siteUrl,
      pagePrefix,
    };
  }

  const fallback = contexts[0];
  if (!siteAllowed(sites, fallback.siteUrl)) return { error: 'seo_site_not_allowed' };
  return {
    context: fallback.id,
    label: fallback.label,
    kind: fallback.kind,
    siteUrl: fallback.siteUrl,
    pagePrefix: fallback.pagePrefix,
  };
}

async function preparedGoogle(request, env, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { response: json(500, { error: 'seo_fetch_unavailable' }) };
  const authorization = await authorizeSeoRequest(request, env, dependencies);
  if (!authorization.ok) return { response: authorization.response };
  const config = googleConfig(env);
  if (!config) return { response: json(503, { error: 'seo_google_not_configured' }) };
  const client = createGoogleClient(config, fetchImpl, dependencies);
  return { fetchImpl, client };
}

export async function handleSeoGoogleSites(request, env, dependencies = {}) {
  const prepared = await preparedGoogle(request, env, dependencies);
  if (prepared.response) return prepared.response;
  try {
    const sites = normalizedSiteEntries(await prepared.client.listSites());
    const contexts = seoContexts(env).map((context) => ({
      ...context,
      available: siteAllowed(sites, context.siteUrl),
    }));
    return json(200, { ok: true, contexts, sites });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error?.status) ? error.status : undefined;
    return json(502, { error: 'search_console_unavailable', ...(upstreamStatus ? { upstreamStatus } : {}) });
  }
}

export async function handleSeoGoogleOverview(request, env, dependencies = {}) {
  const prepared = await preparedGoogle(request, env, dependencies);
  if (prepared.response) return prepared.response;

  let period;
  try {
    const now = dependencies.now ? new Date(nowMilliseconds(dependencies)) : new Date();
    period = resolvePeriod(request, now);
  } catch {
    return json(400, { error: 'invalid_period' });
  }

  try {
    const sites = normalizedSiteEntries(await prepared.client.listSites());
    const scope = resolveScope(request, env, sites);
    if (scope.error === 'seo_site_not_allowed') return json(403, { error: scope.error });
    if (scope.error) return json(400, { error: scope.error });

    const filters = pageFilterGroups(scope.pagePrefix);
    const googleSearch = await loadSearchConsoleOverview({
      client: prepared.client,
      siteUrl: scope.siteUrl,
      ...period,
      rowLimit: 10,
      ...(filters ? { dimensionFilterGroups: filters } : {}),
    });
    const audit = buildSearchConsoleAudit(googleSearch);
    return json(200, { ok: true, scope, googleSearch, audit });
  } catch (error) {
    const upstreamStatus = Number.isInteger(error?.status) ? error.status : undefined;
    return json(502, { error: 'search_console_unavailable', ...(upstreamStatus ? { upstreamStatus } : {}) });
  }
}
