import {
  authenticateClinicalRequest,
  runtimeUserById,
} from './cloudflare-auth-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import {
  handleCloudflareClinicalRuntime as handleLegacyClinicalRuntime,
  hasOwnedRecord,
  runtimeJson,
} from './cloudflare-clinical-legacy-runtime.js';

function requiresCloudflareIdentity(request, url) {
  if (url.pathname.startsWith('/rest/v1/')) return true;
  if (url.pathname.startsWith('/storage/v1/')) {
    return !(request.method === 'GET' && url.searchParams.has('token'));
  }
  return false;
}

/**
 * Cloudflare-only clinical compatibility facade.
 *
 * The old Supabase-shaped implementation remains quarantined behind this facade
 * only while `/rest/v1` and `/storage/v1` callers are being migrated. Requests
 * must authenticate against D1 before the compatibility implementation can run,
 * so its historical Supabase auth fallback is unreachable from active runtime.
 */
export async function handleCloudflareClinicalRuntime(request, env) {
  const url = new URL(request.url);

  // Authentication is owned exclusively by cloudflare-auth-runtime.js.
  // Domain entry handles these routes first; direct callers fail closed here.
  if (url.pathname.startsWith('/auth/v1/')) {
    return runtimeJson(503, { error: 'cloudflare_auth_runtime_required' });
  }

  // Commercial registration was retired from this compatibility runtime.
  if (url.pathname === '/api/license/register-commercial') {
    return runtimeJson(404, { error: 'not_found' });
  }

  // Keep corrected high-value writes ahead of the quarantined compatibility code
  // even when this facade is called directly outside domain-entry.js.
  const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
  if (growthResponse) return growthResponse;

  const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
  if (upsertResponse) return upsertResponse;

  if (requiresCloudflareIdentity(request, url)) {
    if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required' });
  }

  return handleLegacyClinicalRuntime(request, env);
}

export {
  authenticateClinicalRequest,
  hasOwnedRecord,
  runtimeJson,
  runtimeUserById,
};
