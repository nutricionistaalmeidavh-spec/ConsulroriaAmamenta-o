import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const LEGACY_ORIGIN = 'https://zxowxdfhtksevhnjmeyu.supabase.co';
const LEGACY_KEY = 'sb_publishable_yXYUcXiks3Usr1GxHMw2Mg_cPMLD3zt';
const TEMPLATE_FILE = new URL('../patch-source/legacy/growth-feature.supabase-template.js', import.meta.url);
const GROWTH_FILE = new URL('../public/growth-feature.js', import.meta.url);

export function normalizeGrowthRuntimeSource(source) {
  return String(source)
    .replace(/async function db\(path,opt=\{\}\)\{[\s\S]*?\}const E=/, `async function db(path,opt={}){
      const client=window.DeboraRuntimeClient;
      if(client){
        if(path.startsWith('rpc/'))return client.rpc(path.slice(4),opt.body?JSON.parse(opt.body):{});
        const split=path.indexOf('?'),table=split<0?path:path.slice(0,split),query=split<0?'':path.slice(split+1);
        return client.rest(table,{...opt,query,body:opt.body===undefined?undefined:JSON.parse(opt.body)});
      }
      throw new Error('O aplicativo ainda esta iniciando. Tente novamente.');
    }const E=`)
    .replace('function gfScheduleV3(){clearTimeout(gfTimerV3);gfTimerV3=setTimeout(gfEnhanceV3,220)}',
      'function gfScheduleV3(){if(gfTimerV3)return;gfTimerV3=setTimeout(()=>{gfTimerV3=null;gfEnhanceV3()},220)}')
    .replace("gfMountDetailV3();gfMountInlineV3()}catch(e){console.warn('Não foi possível montar sexo/crescimento v3',e)}",
      "gfMountDetailV3();gfMountInlineV3();document.querySelector('[data-growth-load-error]')?.remove()}catch(e){if(routeKey===String(location.hash))gfShowLoadError(e);console.warn('Não foi possível montar sexo/crescimento v3',e)}")

    .replace(`const SB_URL='${LEGACY_ORIGIN}';const SB_KEY='${LEGACY_KEY}';`, "const SB_URL=window.location.origin;const SB_KEY='cloudflare-runtime';")
    .replace("const WHO_BASE='./who/v2026-08-30/';", "const WHO_BASE='/who/v2026-08-30/';")
    .concat(`
function gfShowLoadError(error){
  if(!/^#\\/patient\\/(?!form(?:\\/|$))/.test(String(location.hash)))return;
  const card=gfHistoryCardV3();if(!card)return;
  let notice=card.querySelector('[data-growth-load-error]');
  if(!notice){notice=document.createElement('div');notice.dataset.growthLoadError='1';notice.className='gf-info';notice.setAttribute('role','status');notice.innerHTML='<strong>Curva de peso indisponível</strong><p>Não foi possível carregar as medidas. Tente novamente.</p><button type="button">Tentar novamente</button>';notice.querySelector('button').onclick=()=>gfEnhanceV3();card.appendChild(notice);}
}
`);
}

export async function normalizeGrowthRuntime({ write = true } = {}) {
  const template = await readFile(TEMPLATE_FILE, 'utf8');
  const normalized = normalizeGrowthRuntimeSource(template);

  if (/zxowxdfhtksevhnjmeyu|supabase\.co/i.test(normalized)) {
    throw new Error('growth_runtime_still_contains_legacy_origin');
  }
  if (!normalized.includes("const SB_URL=window.location.origin") || !normalized.includes("const WHO_BASE='/who/v2026-08-30/'")) {
    throw new Error('growth_runtime_cloudflare_contract_missing');
  }

  if (write) {
    await writeFile(GROWTH_FILE, normalized, 'utf8');
    return { changed: true, source: normalized };
  }

  const current = await readFile(GROWTH_FILE, 'utf8');
  if (current !== normalized) throw new Error('growth_runtime_not_materialized');
  return { changed: false, source: current };
}

const executedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (executedDirectly) {
  await normalizeGrowthRuntime({ write: !process.argv.includes('--check') });
}
