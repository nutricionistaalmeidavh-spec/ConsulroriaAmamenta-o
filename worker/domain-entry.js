import coreWorker from './index.js';
import { handleSeoGoogleOverview, handleSeoGoogleSites, handleSeoPasswordLogin } from './seo-search-console.js';
import { ensureExplicitCommercialMarker } from './commercial-license-bootstrap.js';
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
  // Responses created by this Worker have mutable headers. Mutating them in place
  // preserves ownership of the original body stream instead of rebinding the same
  // ReadableStream into a second Response, which can surface as a disturbed/locked
  // body in browser Fetch implementations.
  try {
    response.headers.set('x-robots-tag', 'noindex, nofollow');
    return response;
  } catch {
    // Fetch-derived responses can expose immutable headers. Clone first so the
    // fallback never transfers the original response's live body stream.
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

    // Existing accounts are migrated on first successful login. Cloudflare Workers
    // caps PBKDF2 at 100k iterations, so password login uses the compatibility bridge
    // before entering the general clinical runtime.
    const passwordCompatResponse = await handleCloudflarePasswordCompat(request, env, url);
    if (passwordCompatResponse) return withNoIndex(passwordCompatResponse);

    // A migrated saas_accounts row is an explicit commercial marker. Promote it into
    // the central Artisys license authority before the first Cloudflare license read.
    if (env.CLINICAL_DB && url.pathname === '/api/license/me' && request.method === 'GET') {
      await ensureExplicitCommercialMarker(request, env);
    }

    // CLINICAL_DB is the cutover switch. Without the binding this returns null and
    // the current Supabase-backed runtime remains available as an immediate rollback.
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
