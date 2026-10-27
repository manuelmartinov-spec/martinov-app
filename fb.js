/* Martinov aplikacija — veza sa Firebase (baza, prijava, fajlovi, privatni podaci).
   Daje isti interfejs kao Claude (window.claude.use), pa ostatak aplikacije radi bez izmena. */
import {initializeApp} from './lib/firebase-app.js';
import {initializeFirestore,getFirestore,persistentLocalCache,persistentMultipleTabManager,doc,collection,getDoc,getDocFromCache,getDocsFromCache,getDocs,setDoc,updateDoc,deleteDoc,onSnapshot,writeBatch,FieldPath} from './lib/firebase-firestore.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,signInWithRedirect,getRedirectResult,onAuthStateChanged,signOut} from './lib/firebase-auth.js';
import {FIREBASE_CONFIG} from './config.js';

const T=window.__MT_TEST||null;          /* samo za lokalni test */
const app=initializeApp(FIREBASE_CONFIG);
let fs;
try{fs=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})})}catch(e){fs=getFirestore(app)}
const auth=getAuth(app);

/* ---------- pomoćno ---------- */
const CODES={'permission-denied':'not_granted','unauthenticated':'not_granted','unavailable':'unavailable','deadline-exceeded':'unavailable','aborted':'unavailable','resource-exhausted':'quota_exceeded','not-found':'invalid_argument','invalid-argument':'invalid_argument','failed-precondition':'invalid_argument'};
function mapErr(e){const raw=String((e&&e.code)||'').replace(/^firestore\//,'');const x=new Error((e&&e.message)||raw||'greška');x.code=CODES[raw]||'unknown';x.raw=raw;return x}
function writeErr(e){const x=mapErr(e);try{window.dispatchEvent(new CustomEvent('mt-write-error',{detail:{code:x.code,raw:x.raw}}))}catch(_){}}
/* Firestore ne prima niz u nizu → kodiramo ga kao {__a:[...]} */
function enc(v){if(Array.isArray(v))return v.map(x=>Array.isArray(x)?{__a:enc(x)}:enc(x));if(v&&typeof v==='object'){const o={};for(const k in v){const x=v[k];if(x===undefined)continue;o[k]=enc(x)}return o}return v}
function dec(v){if(Array.isArray(v))return v.map(dec);if(v&&typeof v==='object'){if(Array.isArray(v.__a)&&Object.keys(v).length===1)return dec(v.__a);const o={};for(const k in v)o[k]=dec(v[k]);return o}return v}
const clean=d=>enc(JSON.parse(JSON.stringify(d==null?{}:d)));
function dsnap(s){const ex=s.exists();const d=ex?dec(s.data()):undefined;return{id:s.id,exists:ex,data:()=>d,metadata:{fromCache:s.metadata.fromCache,hasPendingWrites:s.metadata.hasPendingWrites}}}
function csnap(q){const docs=q.docs.map(dsnap);return{docs,size:docs.length,empty:!docs.length,docChanges:()=>q.docChanges().map(c=>({type:c.type,doc:dsnap(c.doc)})),metadata:{fromCache:q.metadata.fromCache,hasPendingWrites:q.metadata.hasPendingWrites}}}
/* upis se odmah primenjuje lokalno (radi i bez interneta); greška sa servera stiže kasnije kao događaj */
function fire(p){p.catch(writeErr);return Promise.resolve()}
const commit=b=>T&&T.noWait?fire(b.commit()):b.commit();
/* prvo iz memorije uređaja (radi bez interneta), pa sa servera */
async function getC(ref){try{const s=await getDocFromCache(ref);if(s.exists())return s}catch(e){}return getDoc(ref)}
function timeout(p,ms){return Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej({code:'unavailable'}),ms))])}
function flat(o,pre,out){for(const k in o){const v=o[k];const path=pre.concat(k);if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length&&!('__a' in v))flat(v,path,out);else out.push([path,v])}return out}

/* ---------- baza ---------- */
function D(path){const r=doc(fs,path);return{id:r.id,path,
  async get(){try{return dsnap(await getDoc(r))}catch(e){throw mapErr(e)}},
  set(d){return fire(setDoc(r,clean(d)))},
  async update(d){let exists=null;try{exists=(await getDocFromCache(r)).exists()}catch(e){exists=null}
    if(exists===false)throw mapErr({code:'not-found'});
    const pairs=flat(clean(d),[],[]);if(!pairs.length)return;const args=[];for(const [p,v] of pairs){args.push(new FieldPath(...p),v)}
    return fire(updateDoc(r,...args))},
  delete(){return fire(deleteDoc(r))},
  onSnapshot(next,err){return onSnapshot(r,s=>next(dsnap(s)),e=>err&&err(mapErr(e)))},
  collection(c){return C(path+'/'+c)}}}
function C(path){const r=collection(fs,path);return{path,id:r.id,
  doc(id){return D(id?path+'/'+id:doc(r).path)},
  async get(){try{return csnap(await getDocs(r))}catch(e){throw mapErr(e)}},
  onSnapshot(next,err){return onSnapshot(r,q=>next(csnap(q)),e=>err&&err(mapErr(e)))}}}
const dbApi={doc:D,collection:C};

/* ---------- korisnik ---------- */
let me=null;const prof={};
const userApi={
  async id(){return me?me.uid:null},
  async me(){return me?{id:me.uid,name:me.displayName||'',email:me.email||'',isMe:true}:null},
  async isOwner(){return true},async canEdit(){return true},async can(){return true},
  async profiles(ids){const out={};for(const id of [].concat(ids||[])){if(!id)continue;if(!(id in prof)){try{const s=await getDoc(doc(fs,'people/'+id));prof[id]=s.exists()?s.data():null}catch(e){prof[id]=null}}
    const p=prof[id];out[id]={id,name:(p&&p.name)||'',isMe:!!(me&&id===me.uid)}}return out}
};

/* ---------- fajlovi u bazi (delovi do 700 KB) ---------- */
const CH=700000;const fcache=new Map();const fload=new Map();
function b64(u8){let s='';for(let i=0;i<u8.length;i+=0x8000)s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
function fid(){return doc(collection(fs,'files')).id}
async function putFile(blob,name,type,id){
  id=id||fid();const u8=new Uint8Array(await blob.arrayBuffer());const s=b64(u8);const n=Math.max(1,Math.ceil(s.length/CH));
  let b=writeBatch(fs);let ops=0;
  for(let i=0;i<n;i++){b.set(doc(fs,'files/'+id+'/c/'+i),{d:s.slice(i*CH,(i+1)*CH)});ops++;if(ops>=8){fire(b.commit());b=writeBatch(fs);ops=0}}
  b.set(doc(fs,'files/'+id),{name:name||'',type:type||blob.type||'',size:u8.length,n,at:Date.now(),by:me?me.uid:null});fire(b.commit());
  fcache.set(id,URL.createObjectURL(new Blob([u8],{type:type||blob.type||'application/octet-stream'})));
  return id}
async function getBlob(id){
  const m=await getC(doc(fs,'files/'+id));if(!m.exists())throw new Error('nema fajla');const meta=m.data();let s='';
  for(let i=0;i<(meta.n||1);i++){const c=await getC(doc(fs,'files/'+id+'/c/'+i));if(!c.exists())throw new Error('deo fajla fali');s+=c.data().d}
  return new Blob([unb64(s)],{type:meta.type||'application/octet-stream'})}
const filesApi={
  cached(a){return a&&a.id?fcache.get(a.id)||'':''},
  load(a){if(!a||!a.id)return Promise.reject();if(fcache.has(a.id))return Promise.resolve(fcache.get(a.id));if(fload.has(a.id))return fload.get(a.id);
    const p=getBlob(a.id).then(bl=>{const u=URL.createObjectURL(bl);fcache.set(a.id,u);fload.delete(a.id);return u},e=>{fload.delete(a.id);throw e});fload.set(a.id,p);return p},
  async blob(a){if(!a||!a.id)throw new Error('nema fajla');return getBlob(a.id)}
};
window.__mtFiles=filesApi;
const assetsApi={
  async upload(blob,opt){if(blob.size>20*1024*1024)throw{code:'too_large'};const type=(opt&&opt.type)||blob.type||'';
    if(!/^image\/|pdf/.test(type))throw{code:'unsupported_type'};const id=await putFile(blob,blob.name||'',type);return{id,url:'mtf:'+id,sizeBytes:blob.size,contentType:type}},
  async list(){return{assets:[],usage:{}}},async delete(){return true}
};

/* ---------- čuvanje fajla na računar / telefon ---------- */
const MIME={pdf:'application/pdf',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',csv:'text/csv',json:'application/json'};
const downloadsApi={async save(o){
  const name=o.filename||'fajl';const ext=(name.split('.').pop()||'').toLowerCase();const type=o.type||MIME[ext]||'application/octet-stream';
  const blob=o.data instanceof Blob?o.data:new Blob([o.data],{type});
  if(window.showSaveFilePicker&&!/Android|iPhone|iPad/i.test(navigator.userAgent)){
    let h;try{h=await window.showSaveFilePicker({suggestedName:name,id:'martinov'})}catch(e){if(e&&e.name==='AbortError')throw{code:'declined'};h=null}
    if(h){const w=await h.createWritable();await w.write(blob);await w.close();return{status:'saved'}}}
  const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);return{status:'saved'}}};

/* ---------- privatni podaci (cenovnik, podaci firme, izvodi) ---------- */
async function unz(s){const ds=new DecompressionStream('gzip');const st=new Blob([unb64(s)]).stream().pipeThrough(ds);return JSON.parse(await new Response(st).text())}
async function z(obj){const cs=new CompressionStream('gzip');const st=new Blob([JSON.stringify(obj)]).stream().pipeThrough(cs);return b64(new Uint8Array(await new Response(st).arrayBuffer()))}
const priv=new Map();
function getPriv(key){if(priv.has(key))return priv.get(key);const p=(async()=>{const m=await getC(doc(fs,'private/'+key));if(!m.exists())return null;const d=m.data();let s=d.z||'';
  for(let i=1;i<(d.n||1);i++){const c=await getC(doc(fs,'private/'+key+'_'+i));s+=c.exists()?c.data().z:''}return unz(s)})();p.catch(()=>priv.delete(key));priv.set(key,p);return p}
async function putPriv(key,obj){const s=await z(obj);const n=Math.max(1,Math.ceil(s.length/CH));const b=writeBatch(fs);
  for(let i=1;i<n;i++)b.set(doc(fs,'private/'+key+'_'+i),{z:s.slice(i*CH,(i+1)*CH)});b.set(doc(fs,'private/'+key),{z:s.slice(0,CH),n,at:Date.now()});await commit(b);priv.delete(key)}
window.__mtCen=async()=>{const c=await getPriv('cenovnik');if(!c)throw new Error('nema cenovnika');return c};
const safe=o=>JSON.stringify(o).replace(/</g,'\\u003c');
window.__mtAppPre=async app=>{const P={};
  try{if(app==='fakture'){const [d,c]=await Promise.all([getPriv('fakture_def'),getPriv('cenovnik')]);if(d)P.DEF_SET=d;if(c)P.CAT=c}
    if(app==='troskovi'){const s=await getPriv('troskovi_seed');if(s)P.SEED=s}}catch(e){}
  return'<script>window.__PRIV='+safe(P)+'<\/script>'};

/* ---------- uvoz podataka iz Claude aplikacije ---------- */
window.__mtImport=async(pkg,progress)=>{
  const docs=pkg.docs||{};const keys=Object.keys(docs);let done=0;const total=keys.length+(pkg.files?Object.keys(pkg.files).length:0)+3;const tick=()=>progress&&progress(Math.min(1,++done/total));
  for(let i=0;i<keys.length;i+=300){const b=writeBatch(fs);for(const k of keys.slice(i,i+300)){b.set(doc(fs,k),clean(docs[k]));tick()}await commit(b)}
  for(const [id,f] of Object.entries(pkg.files||{})){try{await putFile(new Blob([unb64(f.b64)],{type:f.type||''}),f.name,f.type,id)}catch(e){}tick()}
  const p=pkg.private||{};if(p.cenovnik)await putPriv('cenovnik',p.cenovnik);tick();if(p.fakture_def)await putPriv('fakture_def',p.fakture_def);tick();if(p.troskovi_seed)await putPriv('troskovi_seed',p.troskovi_seed);tick();
  return{docs:keys.length,files:Object.keys(pkg.files||{}).length}};
window.__mtHasData=async()=>{try{const c=await getDocsFromCache(collection(fs,'tables'));if(!c.empty)return true}catch(e){}
  if(!navigator.onLine||(T&&!T.online))return null;try{const s=await timeout(getDocs(collection(fs,'tables')),8000);return!s.empty}catch(e){return null}};

/* ---------- prijava ---------- */
const gate=document.getElementById('login');const gmsg=document.getElementById('loginMsg');
function showGate(state,text){if(!gate)return;gate.hidden=state==='ok';gate.dataset.s=state;if(gmsg)gmsg.textContent=text||''}
async function doLogin(){const p=new GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});showGate('wait','Otvaram Google prijavu…');
  try{await signInWithPopup(auth,p)}catch(e){const c=e&&e.code||'';
    if(/popup-blocked|operation-not-supported/.test(c)){try{await signInWithRedirect(auth,p);return}catch(e2){}}
    showGate('out',/popup-closed|cancelled/.test(c)?'':'Prijava nije uspela'+(c?' ('+c.replace('auth/','')+')':'')+'. Pokušaj ponovo.')}}
window.__mtLogin=doLogin;
window.__mtLogout=async()=>{try{await signOut(auth)}catch(e){}location.reload()};
document.getElementById('loginBtn')&&document.getElementById('loginBtn').addEventListener('click',doLogin);
document.getElementById('loginOut')&&document.getElementById('loginOut').addEventListener('click',()=>window.__mtLogout());
getRedirectResult(auth).catch(()=>{});

let ready;const readyP=new Promise(r=>{ready=r});
const API={db:dbApi,user:userApi,assets:assetsApi,downloads:downloadsApi};
window.__fbUse=n=>readyP.then(()=>API[n]||null);
if(window.__fbResolve)window.__fbResolve(window.__fbUse);

async function admit(u){
  me=u;showGate('wait','Proveravam pristup…');
  setDoc(doc(fs,'people/'+u.uid),{name:u.displayName||'',email:(u.email||'').toLowerCase(),photo:u.photoURL||'',seen:Date.now()},{merge:true}).catch(()=>{});
  if(navigator.onLine&&!T){const chk=getDocs(collection(fs,'tables')).then(()=>'ok',e=>mapErr(e).code);
    const res=await Promise.race([chk,new Promise(r=>setTimeout(()=>r('timeout'),8000))]);
    if(res==='not_granted'){showGate('denied','Nalog '+(u.email||'')+' nema pristup. Javi Manuelu da te doda.');return}}
  showGate('ok');ready();
}
if(T&&T.user){admit(T.user)}
else onAuthStateChanged(auth,u=>{if(u)admit(u);else{me=null;showGate('out','')}});
window.__mtUser=()=>me;
window.__mtSetPriv=putPriv;
