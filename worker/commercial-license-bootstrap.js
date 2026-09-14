import { authenticateClinicalRequest, hasOwnedRecord } from './cloudflare-clinical-runtime.js';

const SUPABASE_URL='https://zxowxdfhtksevhnjmeyu.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';

function bearer(request){const value=request.headers.get('authorization')||'';const match=value.match(/^Bearer\s+(.+)$/i);return match?match[1]:''}
async function userForToken(token){
  if(!token)return null;
  const response=await fetch(`${SUPABASE_URL}/auth/v1/user`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:`Bearer ${token}`,accept:'application/json'}});
  if(!response.ok)return null;
  const user=await response.json().catch(()=>null);return user?.id&&user?.email?user:null;
}
async function isSaasAccount(token,userId){
  const response=await fetch(`${SUPABASE_URL}/rest/v1/saas_accounts?owner_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,{headers:{apikey:SUPABASE_PUBLISHABLE_KEY,authorization:`Bearer ${token}`,accept:'application/json'}});
  if(!response.ok)return false;
  const rows=await response.json().catch(()=>[]);return Array.isArray(rows)&&rows.length>0;
}
async function licenseCall(env,body){
  if(!env.ARTISYS_LICENSING||!env.LICENSE_SERVICE_SECRET)return null;
  const response=await env.ARTISYS_LICENSING.fetch(new Request('https://artisys-licensing.internal/api/internal/product-license',{method:'POST',headers:{'content-type':'application/json','x-artisys-license-secret':env.LICENSE_SERVICE_SECRET},body:JSON.stringify(body)}));
  if(!response.ok)return null;return response.json().catch(()=>null);
}

// Existing clinical accounts remain unmanaged. Only an account that was explicitly
// commercial (saas_accounts) is promoted into the central Artisys license D1.
export async function ensureExplicitCommercialMarker(request,env){
  let user=null,explicitCommercial=false,source='supabase_saas_account';

  if(env.CLINICAL_DB){
    user=await authenticateClinicalRequest(request,env);
    if(!user?.id||!user?.email)return;
    explicitCommercial=await hasOwnedRecord(env,'saas_accounts',user.id);
    source='migrated_saas_account';
  }else{
    const token=bearer(request);
    user=await userForToken(token);
    if(!user)return;
    explicitCommercial=await isSaasAccount(token,user.id);
  }

  const access=await licenseCall(env,{action:'resolve',productCode:'debora-lactacao',email:user.email});
  if(access?.commercial===true||!explicitCommercial)return;
  await licenseCall(env,{action:'register',productCode:'debora-lactacao',email:user.email,source});
}
