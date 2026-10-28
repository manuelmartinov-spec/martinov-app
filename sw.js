/* Martinov aplikacija — rad bez interneta i samo-ažuriranje */
const V='1.2.0';
const SHELL='mt-shell-'+V, RUN='mt-run-v1';
const CORE=['./','index.html','fb.js','config.js','manifest.webmanifest','version.json','lib/firebase-app.js','lib/firebase-auth.js','lib/firebase-firestore.js','apps/fakture.html','apps/zadaci.html','apps/troskovi.html','icons/m-icon-192.png','icons/m-icon-512.png','icons/m-maskable-512.png','icons/m-favicon-64.png','icons/m-apple-180.png','icons/m-badge-96.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(SHELL).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('mt-shell-')&&k!==SHELL)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='skip')self.skipWaiting()});
self.addEventListener('fetch',e=>{
  const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);
  if(u.origin===location.origin){
    if(u.pathname.endsWith('/version.json')){e.respondWith(fetch(r).catch(()=>caches.match(r)));return}
    e.respondWith((async()=>{const c=await caches.open(SHELL);const hit=await c.match(r,{ignoreSearch:true})||(r.mode==='navigate'?await c.match('index.html'):null);if(hit)return hit;
      try{const res=await fetch(r);if(res.ok&&/\/lib\//.test(u.pathname)){const rc=await caches.open(RUN);rc.put(r,res.clone())}return res}catch(x){const rc=await caches.open(RUN);const h=await rc.match(r);if(h)return h;throw x}})());return}
  if(/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)){
    e.respondWith((async()=>{const c=await caches.open(RUN);const h=await c.match(r);if(h)return h;const res=await fetch(r);try{c.put(r,res.clone())}catch(x){}return res})())}
});
/* obaveštenja: jutarnji spisak (šalje ga program na GitHub-u preko Firebase Cloud Messaging) */
self.addEventListener('push',e=>{let p={};try{p=e.data?e.data.json():{}}catch(x){p={data:{body:e.data?e.data.text():''}}}
  const d=p.data||{},n=p.notification||{};const title=d.title||n.title||'Martinov';const body=d.body||n.body||'';
  e.waitUntil(self.registration.showNotification(title,{body,icon:'icons/m-icon-192.png',badge:'icons/m-badge-96.png',tag:d.tag||'mt-podsetnik',renotify:true,data:{url:d.url||'./'}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL((e.notification.data&&e.notification.data.url)||'./',self.registration.scope);const m=url.searchParams.get('m')||'';
  e.waitUntil((async()=>{const cs=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of cs){if(c.url.startsWith(self.registration.scope)){try{await c.focus()}catch(x){}c.postMessage({type:'mt-open',m});return}}
    await self.clients.openWindow(url.href)})())});
