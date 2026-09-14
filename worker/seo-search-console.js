import { createGoogleRefreshTokenProvider } from './vendor/artisys-seo/google-token.mjs';
import { createSearchConsoleClient } from './vendor/artisys-seo/search-console.mjs';
import { loadSearchConsoleOverview } from './vendor/artisys-seo/search-console-overview.mjs';

const DEFAULT_SEO_ADMIN_EMAIL = 'nutricionistaalmeidavh@gmail.com';
const SEO_GOOGLE_LOGIN_CLIENT_ID = '826322917381-ia1khl7es1gqddv6jsmg8p75m7amfle5.apps.googleusercontent.com';
const SEO_SESSION_COOKIE = 'artisys-seo-session';
const SEO_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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

async function authorizeSeoRequest(request, env, dependencies = {}) {
  const configuredAdminToken = signingSecret(env);
  const presentedToken = bearerToken(request);
  if (configuredAdminToken && presentedToken && constantTimeTextEqual(presentedToken, configuredAdminToken)) {
    return { ok: true, method: 'admin_token' };
  }

  const sessionToken = cookieValue(request, SEO_SESSION_COOKIE);
  if (sessionToken && await verifySeoSessionToken(sessionToken, env, dependencies)) {
    return { ok: true, method: 'google_oauth', email: adminEmail(env) };
  }

  return { ok: false, response: json(401, { error: 'unauthorized' }) };
}

export async function handleSeoGoogleSession(request, env, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return json(500, { error: 'seo_fetch_unavailable' });
  if (!signingSecret(env)) return json(503, { error: 'seo_admin_not_configured' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'invalid_request' }); }
  const accessToken = text(body?.accessToken);
  if (!accessToken || accessToken.length < 8) return json(401, { error: 'google_identity_invalid' });

  let tokenInfoResponse;
  try {
    tokenInfoResponse = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
  } catch {
    return json(502, { error: 'google_identity_unavailable' });
  }

  let tokenInfo;
  try { tokenInfo = await tokenInfoResponse.json(); } catch { tokenInfo = {}; }
  if (!tokenInfoResponse.ok || text(tokenInfo?.aud) !== SEO_GOOGLE_LOGIN_CLIENT_ID) {
    return json(401, { error: 'google_identity_invalid' });
  }

  let userResponse;
  try {
    userResponse = await fetchImpl('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return json(502, { error: 'google_identity_unavailable' });
  }

  let user;
  try { user = await userResponse.json(); } catch { user = {}; }
  const email = text(user?.email).toLowerCase();
  if (!userResponse.ok || user?.verified_email !== true || !email) return json(401, { error: 'google_identity_invalid' });
  if (email !== adminEmail(env)) return json(403, { error: 'forbidden' });

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
        recommendation: 'Revisar título e descrição da página para responder melhor à intenção desta busca, sem alterar o conteúdo clínico sem aprovação.',
        query: row.query, ...opportunityBase(row),
      });
    }
    if (row.impressions >= 30 && row.position >= 4 && row.position <= 20) {
      opportunities.push({
        type: 'ranking_opportunity', priority: row.position <= 10 ? 'high' : 'medium', label: 'Perto da 1ª página',
        title: `Ganhar posição para “${row.query}”`,
        recommendation: 'Reforçar a relevância semântica da landing para esta intenção e acompanhar a evolução da posição média.',
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

export async function handleSeoGoogleOverview(request, env, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return json(500, { error: 'seo_fetch_unavailable' });

  const authorization = await authorizeSeoRequest(request, env, dependencies);
  if (!authorization.ok) return authorization.response;

  const config = googleConfig(env);
  if (!config) return json(503, { error: 'seo_google_not_configured' });

  let period;
  try {
    const now = dependencies.now ? new Date(nowMilliseconds(dependencies)) : new Date();
    period = resolvePeriod(request, now);
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
    return json(502, { error: 'search_console_unavailable', ...(upstreamStatus ? { upstreamStatus } : {}) });
  }
}
