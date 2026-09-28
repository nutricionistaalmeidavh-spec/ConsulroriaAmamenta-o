import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { resolveProductAccess } from './product-access-runtime.js';

// Existing clinical accounts remain unmanaged. Only an account explicitly marked
// commercial in the canonical D1 data is promoted into the central Artisys license D1.
export async function ensureExplicitCommercialMarker(request,env){
  if(!env.CLINICAL_DB)throw new Error('clinical_db_not_configured');
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id||!user?.email)return;

  await resolveProductAccess(env,user);
}
