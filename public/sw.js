const VERSION='1.14.0-cloudflare-native';
const CACHE_NAME=`debora-lactacao-v${VERSION}`;
const SHELL=['./','./manifest.webmanifest','./icon.svg','./icon-192.png?v=1.12.1','./icon-512.png?v=1.12.1','./growth-feature.js','./growth-feature.css','./weight-evolution-v5.js','./weight-evolution-v5.css','./billing-v2.js','./p0-route-guard.js','./phase68-loader.js','./package-card-singleton-guard.js','./member-feature.js','./member-feature.css','./library-disabled.js','./library-disabled.css','./template-gallery.js','./template-gallery.css','./interaction-ui.js','./interaction-ui.css','./template-runtime.js.gz','./demo-feature.js','./who/v2026-08-30/who-wfa-male.csv','./who/v2026-08-30/who-wfa-female.csv','./who/v2026-08-30/who-lfa-male.csv','./who/v2026-08-30/who-lfa-female.csv','./who/v2026-08-30/who-wfl-male.csv','./who/v2026-08-30/who-wfl-female.csv','./who/v2026-08-30/who-hc-male.csv','./who/v2026-08-30/who-hc-female.csv'];
const PRIVATE_PREFIXES=['/api/','/auth/','/rest/','/storage/','/admin/','/clinical-source/'];
self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const url of SHELL){
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
  event.respondWith(fetch(new Request(event.request,{cache:'no-cache'})).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy))}
    return response;
  }).catch(()=>caches.open(CACHE_NAME).then(cache=>cache.match(event.request).then(hit=>hit||(event.request.mode==='navigate'?cache.match('./'):Response.error())))));
});
