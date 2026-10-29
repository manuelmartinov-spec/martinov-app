// Claude prijem — robot koji upisuje pakete od Claude-a u bazu aplikacije i, kad Claude traži, daje mu zaključan izvoz podataka.
// Pokreće ga GitHub Actions (.github/workflows/prijem.yml) kad Claude pošalje fajl u prijem/ulaz ili prijem/zahtev.
// Paketi su zaključani (RSA-OAEP 3072 + AES-256-GCM). Tajni ključ se pravi ovde i čuva SAMO u bazi (private/prijem_kljuc);
// u projektu je samo javni ključ (prijem/kljuc.pub.pem) kojim Claude zaključava pakete. Izvoz za Claude-a se zaključava
// jednokratnim javnim ključem koji Claude pošalje uz zahtev. Dnevnik (log) nikad ne ispisuje sadržaj – samo brojeve.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PROJECT = 'martinov-app';
const ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const FS = (process.env.FS_BASE || 'https://firestore.googleapis.com/v1') + '/' + ROOT;
const DIR = process.env.PRIJEM_DIR || 'prijem';
const IN = DIR + '/ulaz', REQ = DIR + '/zahtev', OUT = DIR + '/izvoz', RES = DIR + '/rezultat', PUB = DIR + '/kljuc.pub.pem';
const CH = 700000; // isti delovi kao u aplikaciji (fb.js)
const log = (...a) => console.log(...a);

function b64u(x) { return Buffer.from(x).toString('base64url'); }
async function accessToken(sa) {
  if (process.env.FS_TOKEN) return process.env.FS_TOKEN; // samo za lokalnu probu
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const aud = sa.token_uri || 'https://oauth2.googleapis.com/token';
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud, iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + claim), sa.private_key).toString('base64url');
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('prijava servisnog naloga nije uspela (' + r.status + ')');
  return j.access_token;
}

/* ---------- vrednosti u bazi (isto kao aplikacija: niz u nizu ide kao {__a:[…]}) ---------- */
function enc(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === 'string') return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(v => Array.isArray(v) ? { mapValue: { fields: { __a: enc(v) } } } : enc(v)) } };
  if (typeof x === 'object') { const f = {}; for (const k in x) if (x[k] !== undefined) f[k] = enc(x[k]); return { mapValue: { fields: f } }; }
  return { stringValue: String(x) };
}
function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) { const o = obj(v.mapValue.fields || {}); return o && Object.keys(o).length === 1 && Array.isArray(o.__a) ? o.__a : o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return null;
}
function obj(f) { const o = {}; for (const k in f) o[k] = val(f[k]); return o; }

async function api(tok, url, opt = {}) {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...opt, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', ...(opt.headers || {}) } });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
    if ((r.status === 429 || r.status >= 500) && i < 4) { await new Promise(s => setTimeout(s, 1500 * (i + 1))); continue; }
    return { ok: r.ok, status: r.status, j, t };
  }
}
async function getDoc(tok, p) { const r = await api(tok, FS + '/' + p); if (r.status === 404) return null; if (!r.ok) throw new Error('baza: čitanje ' + r.status); return obj((r.j && r.j.fields) || {}); }
const upd = (p, o, pre) => ({ update: { name: ROOT + '/' + p, fields: enc(o).mapValue.fields }, ...(pre ? { currentDocument: pre } : {}) });
async function commit(tok, writes) {
  if (!writes.length) return;
  const r = await api(tok, FS + ':commit', { method: 'POST', body: JSON.stringify({ writes }) });
  if (!r.ok) throw new Error('baza: upis nije uspeo (' + r.status + (r.j && r.j.error && r.j.error.status ? ' ' + r.j.error.status : '') + ')');
}
async function listColl(tok, coll, deep, out) {
  let page = '';
  do {
    const r = await api(tok, FS + '/' + coll + '?pageSize=300' + (deep ? '&showMissing=true' : '') + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (r.status === 404) return;
    if (!r.ok) throw new Error('baza: lista ' + r.status);
    for (const d of (r.j && r.j.documents) || []) {
      const p = d.name.slice(ROOT.length + 1);
      if (d.fields) out[p] = obj(d.fields);
      if (deep) for (const c of await subcols(tok, p)) await listColl(tok, p + '/' + c, deep, out);
    }
    page = r.j && r.j.nextPageToken;
  } while (page);
}
async function subcols(tok, p) {
  const r = await api(tok, (p ? FS + '/' + p : FS) + ':listCollectionIds', { method: 'POST', body: JSON.stringify({ pageSize: 300 }) });
  return r.ok ? ((r.j && r.j.collectionIds) || []) : [];
}
async function getPriv(tok, key) {
  const m = await getDoc(tok, 'private/' + key); if (!m) return null; let s = m.z || '';
  for (let i = 1; i < (m.n || 1); i++) { const c = await getDoc(tok, 'private/' + key + '_' + i); s += c ? c.z : ''; }
  return JSON.parse(zlib.gunzipSync(Buffer.from(s, 'base64')).toString('utf8'));
}
async function getFile(tok, id) {
  const m = await getDoc(tok, 'files/' + id); if (!m) return null; let s = '';
  for (let i = 0; i < (m.n || 1); i++) { const c = await getDoc(tok, 'files/' + id + '/c/' + i); s += c ? c.d : ''; }
  return { name: m.name || '', type: m.type || '', b64: s };
}

/* ---------- zaključavanje ---------- */
const OAEP = k => ({ key: k, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' });
function seal(buf, pubPem) {
  const k = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv); const ct = Buffer.concat([c.update(buf), c.final()]); const tag = c.getAuthTag();
  const ek = crypto.publicEncrypt(OAEP(pubPem), k);
  const h = Buffer.alloc(6); h.write('MT', 0, 'latin1'); h.writeUInt16BE(1, 2); h.writeUInt16BE(ek.length, 4);
  return Buffer.concat([h, ek, iv, tag, ct]);
}
function unseal(buf, privPem) {
  if (buf.toString('latin1', 0, 2) !== 'MT') throw new Error('fajl nije paket');
  const n = buf.readUInt16BE(4); let o = 6;
  const ek = buf.subarray(o, o += n), iv = buf.subarray(o, o += 12), tag = buf.subarray(o, o += 16), ct = buf.subarray(o);
  const k = crypto.privateDecrypt(OAEP(privPem), ek);
  const d = crypto.createDecipheriv('aes-256-gcm', k, iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

async function ensureKey(tok) {
  let k = await getDoc(tok, 'private/prijem_kljuc');
  if (!k || !k.pem) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    k = { pem: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'pem' }), at: Date.now() };
    await commit(tok, [upd('private/prijem_kljuc', k, { exists: false })]);
    log('Napravljen ključ za prijem (čuva se samo u bazi).');
  }
  const cur = fs.existsSync(PUB) ? fs.readFileSync(PUB, 'utf8') : '';
  if (cur.trim() !== String(k.pub).trim()) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(PUB, k.pub); log('Javni ključ upisan:', PUB); }
  return k;
}

/* ---------- paket od Claude-a → baza ----------
   {id, title, note, docs:{"kolekcija/id": {...}}, del:["kolekcija/id"], files:{id:{name,type,b64}}, priv:{kljuc: objekat}} */
async function applyPkg(tok, p) {
  let W = [], size = 0, nd = 0, nf = 0, nx = 0;
  const flush = async () => { if (W.length) { await commit(tok, W); W = []; size = 0; } };
  const add = async (w, s) => { if (W.length >= 400 || size + s > 6.5e6) await flush(); W.push(w); size += s; };
  for (const [id, f] of Object.entries(p.files || {})) {
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) throw new Error('loš naziv fajla');
    const s = String(f.b64 || '').replace(/\s/g, ''); const n = Math.max(1, Math.ceil(s.length / CH));
    for (let i = 0; i < n; i++) await add(upd(`files/${id}/c/${i}`, { d: s.slice(i * CH, (i + 1) * CH) }), Math.min(CH, s.length - i * CH) + 300);
    await add(upd(`files/${id}`, { name: f.name || '', type: f.type || '', size: Buffer.from(s, 'base64').length, n, at: Date.now(), by: 'claude' }), 500);
    nf++;
  }
  for (const [k, v] of Object.entries(p.docs || {})) {
    const seg = k.split('/'); if (seg.length % 2 || seg.some(x => !/^[A-Za-z0-9_.-]{1,150}$/.test(x))) throw new Error('loša putanja zapisa');
    if (/^(private|prijem)\//.test(k)) throw new Error('zaštićena putanja');
    await add(upd(k, v), JSON.stringify(v).length + 300); nd++;
  }
  for (const k of p.del || []) { if (/^(private|prijem)\//.test(k)) throw new Error('zaštićena putanja'); await add({ delete: ROOT + '/' + k }, 300); nx++; }
  for (const [key, o] of Object.entries(p.priv || {})) {
    if (!/^[a-z_]+$/.test(key) || key === 'prijem_kljuc') throw new Error('loš privatni ključ');
    const s = zlib.gzipSync(Buffer.from(JSON.stringify(o))).toString('base64'); const n = Math.max(1, Math.ceil(s.length / CH));
    for (let i = 1; i < n; i++) await add(upd(`private/${key}_${i}`, { z: s.slice(i * CH, (i + 1) * CH) }), CH);
    await add(upd(`private/${key}`, { z: s.slice(0, CH), n, at: Date.now() }), Math.min(CH, s.length) + 300);
  }
  await add(upd(`prijem/${p.id}`, { id: p.id, title: String(p.title || ''), note: String(p.note || ''), mod: String(p.mod || ''), at: Date.now(), docs: nd, files: nf, del: nx, by: 'claude' }), 1000);
  await flush();
  return { docs: nd, files: nf, del: nx };
}

/* ---------- zahtev Claude-a da pročita podatke → zaključan izvoz ----------
   {id, pub, col:["docs","clients"] ili ["*"], deep:true, priv:["troskovi_seed"], files:["id"]} */
async function doExport(tok, q) {
  const out = { at: Date.now(), docs: {}, priv: {}, files: {} };
  let cols = q.col || [];
  if (cols.includes('*')) cols = (await subcols(tok, '')).filter(c => !['files', 'private', 'prijem'].includes(c)).concat(cols.filter(c => c !== '*'));
  for (const c of [...new Set(cols)]) { if (/^(private|files)(\/|$)/.test(c)) continue; await listColl(tok, c, !!q.deep, out.docs); }
  for (const k of q.priv || []) { if (k === 'prijem_kljuc') continue; out.priv[k] = await getPriv(tok, k); }
  for (const id of (q.files || []).slice(0, 300)) { const f = await getFile(tok, id); if (f) out.files[id] = f; }
  return out;
}

const files = (d, ext) => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(ext)).sort().map(f => path.join(d, f)) : [];
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 1) + '\n'); };

async function main() {
  const raw = process.env.FIREBASE_SA || '';
  if (!raw.trim() && !process.env.FS_TOKEN) { log('FIREBASE_SA nije podešen – preskačem.'); return; }
  const sa = raw.trim() ? JSON.parse(raw) : {};
  const tok = await accessToken(sa);
  const key = await ensureKey(tok);
  for (const f of files(IN, '.bin')) {
    const id = path.basename(f, '.bin');
    try {
      const p = JSON.parse(zlib.gunzipSync(unseal(fs.readFileSync(f), key.pem)).toString('utf8'));
      p.id = id;
      const r = await applyPkg(tok, p);
      writeJson(`${RES}/${id}.json`, { ok: true, ...r, at: new Date().toISOString() });
      fs.unlinkSync(f);
      log('Paket upisan:', id, '· zapisa', r.docs, '· fajlova', r.files, '· obrisano', r.del);
    } catch (e) { writeJson(`${RES}/${id}.json`, { ok: false, err: e.message, at: new Date().toISOString() }); log('Paket NIJE upisan:', id, e.message); }
  }
  for (const f of files(REQ, '.json')) {
    const id = path.basename(f, '.json');
    try {
      const q = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!/BEGIN PUBLIC KEY/.test(q.pub || '')) throw new Error('zahtev nema javni ključ');
      const out = await doExport(tok, q);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(`${OUT}/${id}.bin`, seal(zlib.gzipSync(Buffer.from(JSON.stringify(out))), q.pub));
      writeJson(`${RES}/${id}.json`, { ok: true, docs: Object.keys(out.docs).length, priv: Object.keys(out.priv).length, files: Object.keys(out.files).length, at: new Date().toISOString() });
      log('Izvoz napravljen:', id, '· zapisa', Object.keys(out.docs).length);
    } catch (e) { writeJson(`${RES}/${id}.json`, { ok: false, err: e.message, at: new Date().toISOString() }); log('Izvoz NIJE napravljen:', id, e.message); }
    fs.unlinkSync(f);
  }
}
main().catch(e => { console.error('GREŠKA:', e.message); process.exitCode = 1; });
