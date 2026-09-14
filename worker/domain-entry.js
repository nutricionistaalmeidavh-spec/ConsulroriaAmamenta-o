import coreWorker from './index.js';
import { handleSeoGoogleOverview } from './seo-search-console.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const PRIVATE_ROBOTS_PREFIXES = ['/api', '/app', '/admin', '/clinical-source'];
const SUPABASE_URL = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const SEO_OWNER_EMAIL = 'nutricionistaalmeidavh@gmail.com';

function rewriteAssetRequest(request, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Request(target.toString(), request);
}

function isPrivateRobotsPath(pathname) {
  return PRIVATE_ROBOTS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function withNoIndex(response) {
  const headers = new Headers(response.headers);
  headers.set('x-robots-tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bearerToken(request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function ownerFromProfessionalSession(request) {
  const token = bearerToken(request);
  if (!token) return { ok: false, status: 401 };

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return { ok: false, status: 401 };
  }

  if (!response.ok) return { ok: false, status: 401 };
  const user = await response.json().catch(() => null);
  const email = String(user?.email || '').trim().toLowerCase();
  if (email !== SEO_OWNER_EMAIL) return { ok: false, status: 403 };
  return { ok: true, email };
}

async function handleAuthorizedSeoOverview(request, env) {
  // Preserve the legacy admin-token/HttpOnly fallback first. This keeps existing
  // emergency access working without exposing the secret to the browser.
  const direct = await handleSeoGoogleOverview(request, env);
  if (direct.status !== 401) return direct;

  // Normal browser access reuses the professional Supabase session already used
  // by deboralactacao.com. No Google/Supabase provider or cross-product broker is
  // involved here.
  const owner = await ownerFromProfessionalSession(request);
  if (!owner.ok) {
    return new Response(JSON.stringify({ error: owner.status === 403 ? 'forbidden' : 'unauthorized' }), {
      status: owner.status,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const adminToken = String(env?.ARTISYS_SEO_ADMIN_TOKEN || '').trim();
  if (!adminToken) {
    return new Response(JSON.stringify({ error: 'seo_admin_not_configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${adminToken}`);
  const internalRequest = new Request(request.url, {
    method: request.method,
    headers,
  });
  return handleSeoGoogleOverview(internalRequest, env);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/seo/google/overview' && request.method === 'GET') {
      return withNoIndex(await handleAuthorizedSeoOverview(request, env));
    }

    // API behavior is identical on every bound hostname. Keep it on the core worker
    // so custom-domain routing never changes checkout, webhook or health semantics.
    if (url.pathname.startsWith('/api/')) {
      return withNoIndex(await coreWorker.fetch(request, env, ctx));
    }

    const route = resolvePublicHostRoute(url);
    if (route.type === 'redirect') {
      return new Response(null, {
        status: route.status,
        headers: {
          location: route.location,
          'cache-control': 'public, max-age=300',
        },
      });
    }

    if (route.type === 'rewrite') {
      return env.ASSETS.fetch(rewriteAssetRequest(request, route.pathname));
    }

    const response = await coreWorker.fetch(request, env, ctx);
    return isPrivateRobotsPath(url.pathname) ? withNoIndex(response) : response;
  },
};
