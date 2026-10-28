// Jutarnji podsetnik — šalje obaveštenja na telefone i računare koji su ih uključili u aplikaciji.
// Pokreće ga GitHub Actions (.github/workflows/podsetnik.yml). Bez dodatnih paketa (Node 20+).
// Tajni ključ servisnog naloga dolazi iz GitHub tajne FIREBASE_SA i nikad nije u kodu.
import crypto from 'node:crypto';
import { podText } from './podsetnik-tekst.mjs';

const PROJECT = 'martinov-app';
const APP_URL = 'https://manuelmartinov-spec.github.io/martinov-app/';
const FS = (process.env.FS_BASE || 'https://firestore.googleapis.com/v1') + `/projects/${PROJECT}/databases/(default)/documents`;
const FCM = (process.env.FCM_BASE || 'https://fcm.googleapis.com/v1') + `/projects/${PROJECT}/messages:send`;
const PROBA = /^(1|true|da)$/i.test(process.env.PROBA || '');
const WINDOW_MIN = 4 * 60; // posle izabranog vremena, šalji najkasnije 4 sata (ako GitHub zakasni)
const log = (...a) => console.log(...a);

function b64u(x) { return Buffer.from(x).toString('base64url'); }
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const aud = process.env.TOKEN_URL || sa.token_uri || 'https://oauth2.googleapis.com/token';
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging', aud, iat: now, exp: now + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + claim), sa.private_key).toString('base64url');
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('prijava servisnog naloga nije uspela (' + r.status + ' ' + (j.error || '') + ')');
  return j.access_token;
}
function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return obj(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(val);
  return null;
}
function obj(f) { const o = {}; for (const k in f) o[k] = val(f[k]); return o; }
function enc(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === 'boolean') return { booleanValue: x };
  if (typeof x === 'number') return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  return { stringValue: String(x) };
}
async function api(tok, url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json', ...(opt.headers || {}) } });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
  return { ok: r.ok, status: r.status, j, t };
}
async function getDoc(tok, path) { const r = await api(tok, FS + '/' + path); if (r.status === 404) return null; if (!r.ok) throw new Error('baza: ' + path + ' ' + r.status); return obj((r.j && r.j.fields) || {}); }
async function listDocs(tok, coll) {
  const out = []; let page = '';
  do {
    const r = await api(tok, FS + '/' + coll + '?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (!r.ok) throw new Error('baza: ' + coll + ' ' + r.status);
    for (const d of (r.j && r.j.documents) || []) out.push({ id: d.name.split('/').pop(), ...obj(d.fields || {}) });
    page = r.j && r.j.nextPageToken;
  } while (page);
  return out;
}
async function patch(tok, path, fields, mustExist) {
  const q = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&') + (mustExist ? '&currentDocument.exists=true' : '');
  const f = {}; for (const k in fields) f[k] = enc(fields[k]);
  return api(tok, FS + '/' + path + '?' + q, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
}
function localNow(tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
}
const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : 7 * 60; };

// Srednji kurs evra (Narodna banka Srbije, preko kurs.resenje.org) – jednom dnevno u app_meta/kurs.
// Ručni kurs (polje manual) se ne dira.
async function kursUpdate(tok) {
  try {
    const today = localNow('Europe/Belgrade').date;
    const cur = await getDoc(tok, 'app_meta/kurs');
    if (cur && cur.date === today && cur.eur) return;
    const r = await fetch(process.env.KURS_URL || 'https://kurs.resenje.org/api/v1/currencies/eur/rates/today', { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const v = parseFloat(String(j.exchange_middle).replace(',', '.'));
    if (!(v > 50 && v < 500)) throw new Error('neočekivan kurs ' + j.exchange_middle);
    if (cur && cur.eur === v && cur.date === j.date) return;
    const w = await patch(tok, 'app_meta/kurs', { eur: v, date: String(j.date || today), at: Date.now(), src: 'NBS srednji kurs (kurs.resenje.org)' });
    if (!w.ok) throw new Error('upis ' + w.status);
    log('Kurs evra:', v, j.date);
  } catch (e) { log('Kurs nije preuzet:', e.message); }
}

async function main() {
  const raw = process.env.FIREBASE_SA || '';
  if (!raw.trim()) { log('FIREBASE_SA nije podešen – preskačem (obaveštenja još nisu povezana).'); return { skip: true }; }
  let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('FIREBASE_SA nije ispravan JSON – nalepi ceo sadržaj fajla'); }
  const tok = await accessToken(sa);
  await kursUpdate(tok);
  const devices = (await listDocs(tok, 'naprave')).filter(d => d.on !== false && d.token);
  log('Uređaja sa obaveštenjima:', devices.length);
  const due = devices.filter(d => {
    if (PROBA) return true;
    const n = localNow(d.tz); const t = hm(d.time);
    return d.lastSent !== n.date && n.min >= t && n.min < t + WINDOW_MIN;
  });
  if (!due.length) { log('Nikome sada ne treba slati.'); return { sent: 0 }; }
  const meta = await getDoc(tok, 'app_meta/podsetnik');
  const key = meta && meta.key;
  const pod = key ? await getDoc(tok, 'podsetnik/' + key) : null;
  let data = { tasks: [], shop: [] };
  try { if (pod && pod.json) data = JSON.parse(pod.json); } catch (e) { log('Spisak nije čitljiv:', e.message); }
  let sent = 0, empty = 0, gone = 0; const errs = [];
  for (const d of due) {
    const n = localNow(d.tz);
    let t = podText(data, { tasks: d.tasks !== false, shop: d.shop || 'sve' }, n.date);
    if (PROBA) t = t ? { ...t, title: 'Proba – ' + t.title } : { title: 'Martinov – proba', body: 'Obaveštenja rade. Danas nema ništa hitno ni za kupovinu.', m: 'zadaci' };
    if (!t) { empty++; await patch(tok, 'naprave/' + d.id, { lastSent: n.date, lastNote: 'prazno', lastAt: Date.now() }, true); continue; }
    const r = await api(tok, FCM, { method: 'POST', body: JSON.stringify({ message: { token: d.token, webpush: { headers: { TTL: '21600', Urgency: 'high' }, data: { title: t.title, body: t.body, url: APP_URL + '?m=' + (t.m || 'zadaci'), tag: 'mt-podsetnik' } } } }) });
    const code = r.j && r.j.error && ((r.j.error.details || []).map(x => x.errorCode).find(Boolean) || r.j.error.status);
    if (r.ok) { sent++; if (!PROBA) await patch(tok, 'naprave/' + d.id, { lastSent: n.date, lastNote: 'poslato', lastAt: Date.now() }, true); log('Poslato:', d.name || d.email, '·', d.device); }
    else if (r.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /token/i.test(r.t))) {
      gone++; await api(tok, FS + '/naprave/' + d.id, { method: 'DELETE' }); log('Uređaj više ne prima obaveštenja – uklonjen:', d.name || d.email, '·', d.device);
    } else { errs.push((d.device || '?') + ': ' + (code || r.status)); log('Greška za', d.name || d.email, r.status, r.t.slice(0, 300)); }
  }
  const msg = [sent ? 'poslato ' + sent : '', empty ? 'bez sadržaja ' + empty : '', gone ? 'uklonjeno ' + gone : '', errs.length ? 'greške: ' + errs.join(', ') : ''].filter(Boolean).join(', ');
  await patch(tok, 'app_meta/obavestenja', { last: Date.now(), ok: !errs.length, msg: (PROBA ? 'proba – ' : '') + msg });
  log('Gotovo:', msg);
  return { sent, empty, gone, errs };
}

main().then(r => { if (PROBA && r && r.errs && r.errs.length) process.exitCode = 1; }).catch(async e => {
  console.error('GREŠKA:', e.message);
  // greška se upisuje u aplikaciju (Aplikacija → Obaveštenja) da se vidi; zakazana pokretanja ne prijavljuju neuspeh mejlom
  if (PROBA) process.exitCode = 1;
});
