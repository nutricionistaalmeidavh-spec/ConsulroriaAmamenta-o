import {
  authenticateClinicalRequest,
  runtimeUserById,
} from './cloudflare-auth-runtime.js';
import { handleCloudflareGrowthRuntime } from './cloudflare-growth-runtime.js';
import { handleCloudflareUpsertRuntime } from './cloudflare-upsert-runtime.js';
import {
  handleCloudflareDataRuntime,
  hasOwnedRecord,
  runtimeJson,
} from './cloudflare-data-runtime.js';

function requiresCloudflareIdentity(request, url) {
  if (url.pathname.startsWith('/api/clinical/')) return true;
  if (url.pathname.startsWith('/api/files/')) {
    return !(request.method === 'GET' && url.searchParams.has('token'));
  }
  return false;
}

export async function handleCloudflareClinicalRuntime(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/license/register-commercial') {
    return runtimeJson(404, { error: 'not_found' });
  }

  const growthResponse = await handleCloudflareGrowthRuntime(request, env, url);
  if (growthResponse) return growthResponse;

  const upsertResponse = await handleCloudflareUpsertRuntime(request, env, url);
  if (upsertResponse) return upsertResponse;

  if (requiresCloudflareIdentity(request, url)) {
    if (!env.CLINICAL_DB) return runtimeJson(503, { error: 'cloudflare_d1_required' });
    const user = await authenticateClinicalRequest(request, env);
    if (!user?.id) return runtimeJson(401, { error: 'cloudflare_auth_required' });
  }

  return handleCloudflareDataRuntime(request, env, url);
}

export {
  authenticateClinicalRequest,
  hasOwnedRecord,
  runtimeJson,
  runtimeUserById,
};
