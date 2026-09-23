const VERSION='1.14.2-cache-reset';
const CACHE_NAME=`debora-lactacao-v${VERSION}`;
const IMMUTABLE_ASSETS=['./icon-192.png?v=1.12.1','./icon-512.png?v=1.12.1','./who/v2026-08-30/who-wfa-male.csv','./who/v2026-08-30/who-wfa-female.csv','./who/v2026-08-30/who-lfa-male.csv','./who/v2026-08-30/who-lfa-female.csv','./who/v2026-08-30/who-wfl-male.csv','./who/v2026-08-30/who-wfl-female.csv','./who/v2026-08-30/who-hc-male.csv','./who/v2026-08-30/who-hc-female.csv'];
const PRIVATE_PREFIXES=['/api/','/auth/','/rest/','/storage/','/admin/','/clinical-source/'];

function isImmutableAsset(url){
  if(/^\/who\/v\d{4}-\d{2}-\d{2}\//.test(url.pathname))return true;
  return (url.pathname==='/icon-192.png'||url.pathname==='/icon-512.png')&&url.searchParams.has('v');
}

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const url of IMMUTABLE_ASSETS){
      try{const response=await fetch(new Request(url,{cache:'reload'}));if(response.ok)await cache.put(url,response)}catch{}
    }
  })());
});

self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.filter(key=>key.startsWith('debora-lactacao-v')&&key!==CACHE_NAME).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.hostname==='ftp.cdc.gov'||url.origin!==self.location.origin||PRIVATE_PREFIXES.some(prefix=>url.pathname.startsWith(prefix))){
    event.respondWith(fetch(event.request));
    return;
  }

  if(event.request.mode==='navigate'||event.request.destination==='document'){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})).catch(()=>Response.error()));
    return;
  }

  if(!isImmutableAsset(url)){
    event.respondWith(fetch(new Request(event.request,{cache:'no-store'})).catch(()=>Response.error()));
    return;
  }

  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const hit=await cache.match(event.request);
    if(hit)return hit;
    try{
      const response=await fetch(new Request(event.request,{cache:'reload'}));
      if(response.ok)await cache.put(event.request,response.clone());
      return response;
    }catch{
      return Response.error();
    }
  })());
});
