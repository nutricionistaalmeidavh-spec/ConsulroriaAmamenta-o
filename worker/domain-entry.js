import coreWorker from './index.js';
import { handleSeoGoogleOverview, handleSeoGoogleSites, handleSeoPasswordLogin } from './seo-search-console.js';
import { ensureExplicitCommercialMarker } from './commercial-license-bootstrap.js';
import { handleCloudflareBillingRuntime } from './cloudflare-billing-runtime.js';
import { handleCloudflareClinicalRuntime } from './cloudflare-clinical-runtime.js';
import { handleCloudflarePasswordCompat } from './cloudflare-auth-compat.js';
import { isCommercialLandingPath, withCommercialSeo } from './commercial-seo.js';
import { resolvePublicHostRoute } from '../src/public-host-routing.js';

const PRIVATE_ROBOTS_PREFIXES = ['/api', '/app', '/admin', '/clinical-source', '/auth', '/rest', '/storage'];
const COMMERCIAL_GATED_PATHS = new Set(['/api/license/me','/api/clinical/mothers','/api/clinical/media/upload']);

function rewriteAssetRequest(request, pathname) {
  const target = new URL(request.url);
  target.pathname = pathname;
  return new Request(target.toString(), request);
}

function isPrivateRobotsPath(pathname) {
  return PRIVATE_ROBOTS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function withNoIndex(response) {
  try {
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  } catch {
    const copy = response.clone();
    const headers = new Headers(copy.headers);
    headers.set('x-robots-tag', 'noindex, nofollow');
    return new Response(copy.body, {
      status: copy.status,
      statusText: copy.statusText,
      headers,
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/seo/login' && request.method === 'POST') {
      return withNoIndex(await handleSeoPasswordLogin(request, env));
    }
    if (url.pathname === '/api/seo/google/sites' && request.method === 'GET') {
      return withNoIndex(await handleSeoGoogleSites(request, env));
    }
    if (url.pathname === '/api/seo/google/overview' && request.method === 'GET') {
      return withNoIndex(await handleSeoGoogleOverview(request, env));
    }
    if (url.pathname === '/api/license/register-commercial') {
      return withNoIndex(new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }));
    }

    const passwordCompatResponse = await handleCloudflarePasswordCompat(request, env, url);
    if (passwordCompatResponse) return withNoIndex(passwordCompatResponse);

    // Billing and partner attribution are D1-native whenever CLINICAL_DB is bound.
    // This gate deliberately runs before the legacy commercial worker so no Asaas
    // route can silently fall back to Supabase Edge Functions after Cloudflare cutover.
    const cloudflareBillingResponse = await handleCloudflareBillingRuntime(request, env, url);
    if (cloudflareBillingResponse) return withNoIndex(cloudflareBillingResponse);

    if (env.CLINICAL_DB && url.pathname === '/api/license/me' && request.method === 'GET') {
      await ensureExplicitCommercialMarker(request, env);
    }

    const cloudflareRuntimeResponse = await handleCloudflareClinicalRuntime(request, env);
    if (cloudflareRuntimeResponse) return withNoIndex(cloudflareRuntimeResponse);

    if (url.pathname.startsWith('/api/')) {
      if (COMMERCIAL_GATED_PATHS.has(url.pathname)) await ensureExplicitCommercialMarker(request, env);
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
      const response = await env.ASSETS.fetch(rewriteAssetRequest(request, route.pathname));
      return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
    }

    const response = await coreWorker.fetch(request, env, ctx);
    if (isPrivateRobotsPath(url.pathname)) return withNoIndex(response);
    return isCommercialLandingPath(url.pathname) ? withCommercialSeo(response) : response;
  },
};
