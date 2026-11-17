// Robot za alarme i jutarnji spisak — Cloudflare Worker, pokreće se svakog minuta (worker/wrangler.toml).
// 1) Alarmi (alarmi/{id}): kad dođe vreme (next ≤ sada), pošalje obaveštenje na sve uređaje sa uključenim alarmima.
//    Ako niko ne potvrdi, ponovi još 2 puta na 10 minuta. Potvrdu (Urađeno / +10 min) upisuje aplikacija.
// 2) Jutarnji spisak: tačno u vreme koje je svako izabrao (program na GitHub-u ostaje kao rezerva).
// Ključ servisnog naloga je tajna FIREBASE_SA na Cloudflare-u (postavlja je GitHub iz svoje tajne); nikad nije u kodu.
// Radi i u Node-u 20+ (za probu): koristi samo fetch i Web Crypto.
import { podText } from '../tools/podsetnik-tekst.mjs';

const PROJECT = 'martinov-app';
const APP_URL = 'https://manuelmartinov-spec.github.io/martinov-app/';
const TZ = 'Europe/Belgrade';
const NAG_MIN = 10;      // ako niko ne potvrdi, podseti ponovo posle 10 min
const NAG_MAX = 2;       // … najviše još 2 puta
const MAX_REQ = 44;      // Cloudflare besplatno: najviše 50 zahteva po pokretanju
const MORNING_WINDOW = 4 * 60;
const ROBOT_VER = '1.0';

let TOK = null; // {t, exp} – ključ za Google važi sat vremena, čuva se dok je robot „budan“

const te = new TextEncoder();
function b64u(bytes) { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function pemDer(pem) { const b = atob(String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; }

async function accessToken(sa, env, cnt) {
  if (TOK && TOK.exp > Date.now() + 120000) return TOK.t;
  const now = Math.floor(Date.now() / 1000);
  const aud = env.TOKEN_URL || sa.token_uri || 'https://oauth2.googleapis.com/token';
  const head = b64u(te.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64u(te.encode(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging', aud, iat: now, exp: now + 3600 })));
  const key = await crypto.subtle.importKey('pkcs8', pemDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, te.encode(head + '.' + claim)));
  cnt.n++;
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('prijava servisnog naloga nije uspela (' + r.status + ' ' + (j.error || '') + ')');
  TOK = { t: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return TOK.t;
}

/* ---------- Firestore (REST) ---------- */
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
async function api(c, url, opt = {}) {
  if (c.cnt.n >= MAX_REQ) throw new Error('previše zahteva u jednom pokretanju');
  c.cnt.n++;
  const r = await fetch(url, { ...opt, headers: { authorization: 'Bearer ' + c.tok, 'content-type': 'application/json', ...(opt.headers || {}) } });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
  return { ok: r.ok, status: r.status, j, t };
}
async function getDoc(c, path) { const r = await api(c, c.FS + '/' + path); if (r.status === 404) return null; if (!r.ok) throw new Error('baza: ' + path + ' ' + r.status); return obj((r.j && r.j.fields) || {}); }
async function listDocs(c, coll) {
  const out = []; let page = '';
  do {
    const r = await api(c, c.FS + '/' + coll + '?pageSize=300' + (page ? '&pageToken=' + encodeURIComponent(page) : ''));
    if (!r.ok) throw new Error('baza: ' + coll + ' ' + r.status);
    for (const d of (r.j && r.j.documents) || []) out.push({ id: d.name.split('/').pop(), ...obj(d.fields || {}) });
    page = r.j && r.j.nextPageToken;
  } while (page);
  return out;
}
async function dueAlarms(c, now) {
  const body = { structuredQuery: { from: [{ collectionId: 'alarmi' }], where: { fieldFilter: { field: { fieldPath: 'next' }, op: 'LESS_THAN_OR_EQUAL', value: { integerValue: String(now) } } }, limit: 5 } };
  const r = await api(c, c.FS + ':runQuery', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error('baza: alarmi ' + r.status + ' ' + r.t.slice(0, 160));
  return (Array.isArray(r.j) ? r.j : []).filter(x => x && x.document).map(x => ({ id: x.document.name.split('/').pop(), upd: x.document.updateTime, a: obj(x.document.fields || {}) }));
}
async function patch(c, path, fields, cond) {
  const q = Object.keys(fields).map(k => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&') + (cond === true ? '&currentDocument.exists=true' : cond ? '&currentDocument.updateTime=' + encodeURIComponent(cond) : '');
  const f = {}; for (const k in fields) f[k] = enc(fields[k]);
  return api(c, c.FS + '/' + path + '?' + q, { method: 'PATCH', body: JSON.stringify({ fields: f }) });
}

/* ---------- vreme ---------- */
function localNow(tz, ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms == null ? Date.now() : ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute), hhmm: (+p.hour) + ':' + p.minute };
}
const hm = s => { const m = /^(\d{1,2}):(\d{2})/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : 7 * 60; };
function durTxt(min) { min = Math.round(min); if (min < 60) return min + ' min'; const h = Math.floor(min / 60), m = min % 60; return h + (m === 30 ? ',5 h' : ' h' + (m ? ' ' + m + ' min' : '')); }
function repTxt(r) { if (!r) return ''; if (r < 60) return 'svakih ' + r + ' min'; if (r === 60) return 'svakog sata'; if (r % 60 === 0) { const h = r / 60; return (h < 5 ? 'svaka ' : 'svakih ') + h + (h < 5 ? ' sata' : ' sati'); } return 'svakih ' + durTxt(r); }
export function alarmText(a, nag) {
  const t = String(a.t || 'Alarm').replace(/\s+/g, ' ').trim().slice(0, 80);
  const title = (nag ? '⏰ Još niko nije potvrdio: ' : '⏰ ') + t;
  const parts = ['zvoni od ' + localNow(TZ, a.at).hhmm];
  if (a.byName) parts.push('postavio ' + a.byName);
  if (a.rep) parts.push(repTxt(+a.rep));
  let body = parts.join(' · ');
  if (a.note) body += '\n' + String(a.note).slice(0, 140);
  body += '\nKo uradi: „✓ Urađeno“.';
  return { title, body };
}

/* ---------- slanje ---------- */
async function send(c, d, data, ttl) {
  const r = await api(c, c.FCM, { method: 'POST', body: JSON.stringify({ message: { token: d.token, webpush: { headers: { TTL: String(ttl), Urgency: 'high' }, data } } }) });
  if (r.ok) return 'ok';
  const code = r.j && r.j.error && ((r.j.error.details || []).map(x => x.errorCode).find(Boolean) || r.j.error.status);
  if (r.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /token/i.test(r.t))) {
    await api(c, c.FS + '/naprave/' + d.id, { method: 'DELETE' }).catch(() => {});
    if (c.devs) c.devs = c.devs.filter(x => x.id !== d.id);
    return 'gone';
  }
  return 'err:' + (code || r.status);
}
async function devices(c) { if (!c.devs) c.devs = (await listDocs(c, 'naprave')).filter(d => d.on !== false && d.token); return c.devs; }

/* ---------- jedno pokretanje (svakog minuta) ---------- */
export async function tick(env, opt = {}) {
  const now = opt.now ?? Date.now();
  const raw = env.FIREBASE_SA || '';
  if (!raw.trim()) return { skip: 'FIREBASE_SA nije podešen' };
  let sa; try { sa = JSON.parse(raw); } catch (e) { throw new Error('FIREBASE_SA nije ispravan JSON'); }
  const cnt = { n: 0 };
  const c = { cnt, tok: await accessToken(sa, env, cnt), devs: null,
    FS: (env.FS_BASE || 'https://firestore.googleapis.com/v1') + `/projects/${PROJECT}/databases/(default)/documents`,
    FCM: (env.FCM_BASE || 'https://fcm.googleapis.com/v1') + `/projects/${PROJECT}/messages:send` };
  const res = { alarmi: 0, poslato: 0, jutro: 0, uklonjeno: 0, greske: [] };

  /* 1) alarmi kojima je došlo vreme */
  for (const { id, upd, a } of await dueAlarms(c, now)) {
    if (a.on === false || typeof a.next !== 'number' || a.next > now || !a.t) continue;
    const nag = Math.max(0, +a.nag || 0);
    const devs = (await devices(c)).filter(d => d.alarmi !== false);
    const { title, body } = alarmText(a, nag);
    let ok = 0;
    for (const d of devs) {
      if (cnt.n >= MAX_REQ - 2) { res.greske.push('nije stiglo do svih uređaja (ograničenje)'); break; }
      const s = await send(c, d, { kind: 'alarm', id, title, body, url: APP_URL + '?m=alarmi&a=' + encodeURIComponent(id) + '&do=open', tag: 'mt-alarm-' + id }, 1800);
      if (s === 'ok') ok++; else if (s === 'gone') res.uklonjeno++; else res.greske.push((d.device || '?') + ' ' + s);
    }
    const w = await patch(c, 'alarmi/' + id, { next: nag < NAG_MAX ? now + NAG_MIN * 60000 : null, nag: nag + 1, sentAt: now, sentTo: ok }, upd);
    if (!w.ok && w.status !== 400 && w.status !== 409 && w.status !== 412) res.greske.push('upis alarma ' + w.status);
    res.alarmi++; res.poslato += ok;
  }

  /* 2) jutarnji spisak – tačno u izabrano vreme (5:00–10:59) */
  const bg = localNow(TZ, now);
  if (bg.min >= 5 * 60 && bg.min < 11 * 60 && cnt.n < MAX_REQ - 6) {
    const due = (await devices(c)).filter(d => { const n = localNow(d.tz, now); const t = hm(d.time); return d.lastSent !== n.date && n.min >= t && n.min < t + MORNING_WINDOW; });
    if (due.length) {
      const meta = await getDoc(c, 'app_meta/podsetnik');
      const pod = meta && meta.key ? await getDoc(c, 'podsetnik/' + meta.key) : null;
      let data = { tasks: [], shop: [] }; try { if (pod && pod.json) data = JSON.parse(pod.json); } catch (e) { }
      for (const d of due) {
        if (cnt.n >= MAX_REQ - 3) break;
        const n = localNow(d.tz, now);
        const t = podText(data, { tasks: d.tasks !== false, shop: d.shop || 'sve' }, n.date);
        if (!t) { await patch(c, 'naprave/' + d.id, { lastSent: n.date, lastNote: 'prazno', lastAt: now }, true); continue; }
        const s = await send(c, d, { title: t.title, body: t.body, url: APP_URL + '?m=' + (t.m || 'zadaci'), tag: 'mt-podsetnik' }, 21600);
        if (s === 'ok') { res.jutro++; await patch(c, 'naprave/' + d.id, { lastSent: n.date, lastNote: 'poslato', lastAt: now }, true); }
        else if (s === 'gone') res.uklonjeno++; else res.greske.push((d.device || '?') + ' ' + s);
      }
      if (res.jutro) await patch(c, 'app_meta/obavestenja', { last: now, ok: !res.greske.length, msg: 'jutro: poslato ' + res.jutro + ' (robot)' });
    }
  }

  /* 3) znak da robot radi (vidi se u aplikaciji: Alarmi → Ko dobija alarm) */
  const m = new Date(now).getUTCMinutes();
  if (res.alarmi || res.jutro || res.greske.length || m % 30 === 0 || opt.status) {
    const msg = [res.poslato ? 'alarm poslat na ' + res.poslato + ' uređaja' : '', res.jutro ? 'jutarnji spisak ' + res.jutro : '', res.greske.length ? 'greške: ' + res.greske.slice(0, 3).join(', ') : ''].filter(Boolean).join(' · ');
    const prev = (res.alarmi || res.jutro || res.greske.length) ? {} : null;
    await patch(c, 'app_meta/alarmi_robot', Object.assign({ last: now, ok: !res.greske.length, ver: ROBOT_VER }, prev ? { msg, lastSend: now } : {})).catch(() => {});
  }
  res.zahteva = cnt.n;
  return res;
}
