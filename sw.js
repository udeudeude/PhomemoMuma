const CACHE='phomemomuma-documents-v4';
const ASSETS=['./','./index.html','./documents.html','./documents.js','./documents.css','./muma.css','./manifest.webmanifest','./diagnostic.html','./print.html','./app.html','./muma.js'];
const PDF_SCRIPTS=[
'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(ASSETS);
    // External PDF.js assets are optional while installing; cache on first successful online use.
    await Promise.all(PDF_SCRIPTS.map(async url=>{try{const r=await fetch(url);if(r.ok)await cache.put(url,r)}catch(_){}}));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('phomemomuma-')).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin&&!PDF_SCRIPTS.includes(req.url))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    // Use cached PDF library first so previously loaded printer remains usable offline.
    if(PDF_SCRIPTS.includes(req.url)){
      const cached=await cache.match(req);if(cached)return cached;
      const response=await fetch(req);
      if(response.ok)await cache.put(req,response.clone());
      return response;
    }
    try{
      const response=await fetch(req);
      if(response.ok)await cache.put(req,response.clone());
      return response;
    }catch(e){
      const cached=await cache.match(req);if(cached)return cached;
      throw e;
    }
  })());
});
