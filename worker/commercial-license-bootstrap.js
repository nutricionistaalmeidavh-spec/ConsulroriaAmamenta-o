import { authenticateClinicalRequest } from './cloudflare-auth-runtime.js';
import { hasOwnedRecord } from './cloudflare-clinical-runtime.js';

async function licenseCall(env,body){
  if(!env.ARTISYS_LICENSING||!env.LICENSE_SERVICE_SECRET)return null;
  const response=await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license',{method:'POST',headers:{'content-type':'application/json','x-artisys-license-secret':env.LICENSE_SERVICE_SECRET},body:JSON.stringify(body)}));
  if(!response.ok)return null;return response.json().catch(()=>null);
}

// Existing clinical accounts remain unmanaged. Only an account explicitly marked
// commercial in the canonical D1 data is promoted into the central Artisys license D1.
export async function ensureExplicitCommercialMarker(request,env){
  if(!env.CLINICAL_DB)throw new Error('clinical_db_not_configured');
  const user=await authenticateClinicalRequest(request,env);
  if(!user?.id||!user?.email)return;

  const explicitCommercial=await hasOwnedRecord(env,'saas_accounts',user.id);
  const access=await licenseCall(env,{action:'resolve',productCode:'debora-lactacao',email:user.email});
  if(access?.commercial===true||!explicitCommercial)return;
  await licenseCall(env,{action:'register',productCode:'debora-lactacao',email:user.email,source:'d1_saas_account'});
}
