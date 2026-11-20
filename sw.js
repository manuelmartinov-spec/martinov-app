/* Martinov aplikacija — rad bez interneta i samo-ažuriranje */
const V='1.8.4';
const SHELL='mt-shell-'+V, RUN='mt-run-v1';
const CORE=['./','index.html','fb.js','config.js','manifest.webmanifest','version.json','lib/firebase-app.js','lib/firebase-auth.js','lib/firebase-firestore.js','apps/fakture.html','apps/zadaci.html','apps/troskovi.html','apps/nesting.html','apps/pdf.html','apps/kalkulator.html','lib/genie.js','lib/html2canvas.min.js','lib/jspdf.umd.min.js','icons/m-icon-192.png','icons/m-icon-512.png','icons/m-maskable-512.png','icons/m-favicon-64.png','icons/m-apple-180.png','icons/m-badge-96.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('mt-shell-')&&k!==SHELL)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='skip')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const r=e.request;
  /* „Podeli → Martinov“: PDF stiže ovde, čuva se i otvara u aplikaciji */
  if(r.method==='POST'&&new URL(r.url).pathname.endsWith('/share-target')){e.respondWith((async()=>{
    try{const fd=await r.formData();const c=await caches.open('mt-share');for(const k of await c.keys())await c.delete(k);let i=0;
      for(const f of fd.getAll('file')){if(!f||typeof f==='string'||!f.size)continue;await c.put('share/'+(i++),new Response(f,{headers:{'content-type':f.type||'application/pdf','x-name':encodeURIComponent(f.name||'dokument.pdf')}}))}}catch(x){}
    return Response.redirect(new URL('./?share=1',self.registration.scope).href,303)})());return}
  if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin===location.origin){
    if(u.pathname.endsWith('/version.json')){e.respondWith(fetch(r).catch(()=>caches.match(r)));return}
    e.respondWith((async()=>{const c=await caches.open(SHELL);const hit=await c.match(r,{ignoreSearch:true})||(r.mode==='navigate'?await c.match('index.html'):null);if(hit)return hit;
      try{const res=await fetch(r);if(res.ok&&/\/lib\//.test(u.pathname)){const rc=await caches.open(RUN);rc.put(r,res.clone())}return res}catch(x){const rc=await caches.open(RUN);const h=await rc.match(r);if(h)return h;throw x}})());return}
  if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
    e.respondWith((async()=>{const c=await caches.open(RUN);const h=await c.match(r);if(h)return h;const res=await fetch(r);try{c.put(r,res.clone())}catch(x){}return res})())}
});
/* obaveštenja: alarmi (kotao, lepak…) i jutarnji spisak – šalje ih robot na Cloudflare-u preko Firebase Cloud Messaging */
self.addEventListener('push',e=>{let p={};try{p=e.data?e.data.json():{}}catch(x){p={data:{body:e.data?e.data.text():''}}}
  const d=p.data||{},n=p.notification||{};const title=d.title||n.title||'Martinov';const body=d.body||n.body||'';
  if(d.kind==='alarm'&&d.id){e.waitUntil((async()=>{
    /* aplikacija je otvorena i vidi se → ona sama zvoni, obaveštenje ne treba */
    const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const vis=cs.find(c=>c.visibilityState==='visible'&&c.url.startsWith(self.registration.scope));
    if(vis){vis.postMessage({type:'mt-alarm-push',id:d.id});return}
    return self.registration.showNotification(title,{body,icon:'icons/m-icon-192.png',badge:'icons/m-badge-96.png',tag:'mt-alarm-'+d.id,renotify:true,requireInteraction:true,
      vibrate:[600,200,600,200,900],actions:[{action:'done',title:'✓ Urađeno'},{action:'snooze',title:'Još 10 min'}],data:{url:d.url||'./?m=alarmi',alarm:d.id}})})());return}
  e.waitUntil(self.registration.showNotification(title,{body,icon:'icons/m-icon-192.png',badge:'icons/m-badge-96.png',tag:d.tag||'mt-podsetnik',renotify:true,data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const nd=e.notification.data||{};
  const url=new URL(nd.url||'./',self.registration.scope);const m=url.searchParams.get('m')||'';
  const alarm=nd.alarm||'';const act=alarm?(e.action==='done'||e.action==='snooze'?e.action:'open'):'';
  if(alarm){url.searchParams.set('m','alarmi');url.searchParams.set('a',alarm);url.searchParams.set('do',act)}
  e.waitUntil((async()=>{const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs){if(c.url.startsWith(self.registration.scope)){try{await c.focus()}catch(x){}
      if(alarm)c.postMessage({type:'mt-alarm',id:alarm,act});else c.postMessage({type:'mt-open',m});return}}
    await self.clients.openWindow(url.href)})())});
