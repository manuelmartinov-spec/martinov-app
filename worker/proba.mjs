// Proba robota bez interneta: lažni Google (prijava, baza, FCM) na localhost-u. Pokreće se na GitHub-u pre postavljanja.
//   node worker/proba.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { tick, alarmText } from './robot.mjs';

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = { client_email: 'robot@proba', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: '' };

const enc = x => x === null ? { nullValue: null } : typeof x === 'boolean' ? { booleanValue: x } : typeof x === 'number' ? (Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x }) : { stringValue: String(x) };
const dec = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : null;
const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));
const PFX = '/v1/projects/martinov-app/databases/(default)/documents';

let DB, SENT, DELETED, PATCHES, VER = new Map(), BUMP = new Set();
function reset(now) {
  const M = 60000;
  DB = new Map(Object.entries({
    'alarmi/a1': { t: 'Proveri kotao', k: 'kotao', at: now - 2 * M, rep: 120, next: now - 2 * M, nag: 0, on: true, byName: 'Lidija', note: 'ubaci 2 džaka' },
    'alarmi/a2': { t: 'Lepak', k: 'lepak', at: now + 30 * M, next: now + 30 * M, nag: 0, on: true },
    'alarmi/a3': { t: 'Ugašen', at: now - M, next: now - M, nag: 0, on: false },
    'alarmi/a4': { t: 'Treći put', at: now - 25 * M, next: now - M, nag: 2, on: true, byName: 'Manuel' },
    'naprave/d1': { token: 'T1', on: true, name: 'Manuel', device: 'Android telefon', time: '07:00', tz: 'Europe/Belgrade', tasks: true, shop: 'sve' },
    'naprave/d2': { token: 'T2', on: true, name: 'Lidija', device: 'Android telefon', time: '09:30', tz: 'Europe/Belgrade', alarmi: false },
    'naprave/d3': { token: 'MRTAV', on: true, name: 'Stari', device: 'Windows računar', time: '07:00', tz: 'Europe/Belgrade' },
    'app_meta/podsetnik': { key: 'k1' },
    'podsetnik/k1': { json: JSON.stringify({ tasks: [{ title: 'Pozovi Nikolu', due: '', hot: true }], shop: [{ name: 'Tiplovi', qty: 100, unit: 'kom', store: 'Bauhaus' }] }) }
  }));
  SENT = []; DELETED = []; PATCHES = []; VER = new Map(); BUMP = new Set();
}
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const send = (s, j) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/token') { const a = new URLSearchParams(body).get('assertion'); const [h, c, s] = a.split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(h + '.' + c), crypto.createPublicKey(privateKey), Buffer.from(s, 'base64url'));
      return ok ? send(200, { access_token: 'TOK', expires_in: 3600 }) : send(401, { error: 'bad_sig' }); }
    if (req.headers.authorization !== 'Bearer TOK') return send(401, {});
    if (u.pathname === '/fcm/v1/projects/martinov-app/messages:send') { const m = JSON.parse(body).message;
      if (m.token === 'MRTAV') return send(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
      SENT.push(m); return send(200, { name: 'x' }); }
    const p = decodeURIComponent(u.pathname);
    if (p === PFX + ':runQuery') { const q = JSON.parse(body).structuredQuery; const lim = +q.where.fieldFilter.value.integerValue;
      const out = [...DB].filter(([k, v]) => k.startsWith(q.from[0].collectionId + '/') && typeof v.next === 'number' && v.next <= lim).slice(0, q.limit)
        .map(([k, v]) => ({ document: { name: 'projects/martinov-app/databases/(default)/documents/' + k, fields: fields(v), updateTime: 'U-' + k + '-' + (VER.get(k) || 0) } }));
      for (const k of BUMP) VER.set(k, (VER.get(k) || 0) + 1);
      return send(200, out.length ? out : [{ readTime: 'x' }]); }
    if (!p.startsWith(PFX + '/')) return send(404, {});
    const path = p.slice(PFX.length + 1);
    if (req.method === 'GET' && !path.includes('/')) { const docs = [...DB].filter(([k]) => k.startsWith(path + '/')).map(([k, v]) => ({ name: 'x/' + k, fields: fields(v) })); return send(200, { documents: docs }); }
    if (req.method === 'GET') { const d = DB.get(path); return d ? send(200, { fields: fields(d) }) : send(404, {}); }
    if (req.method === 'DELETE') { DELETED.push(path); DB.delete(path); return send(200, {}); }
    if (req.method === 'PATCH') { const f = JSON.parse(body).fields; const cur = Object.assign({}, DB.get(path) || {});
      const ut = u.searchParams.get('currentDocument.updateTime'); if (ut && ut !== 'U-' + path + '-' + (VER.get(path) || 0)) return send(400, { error: { status: 'FAILED_PRECONDITION' } });
      if (u.searchParams.get('currentDocument.exists') === 'true' && !DB.has(path)) return send(404, {});
      for (const k in f) cur[k] = dec(f[k]); DB.set(path, cur); PATCHES.push([path, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, dec(v)]))]); return send(200, {}); }
    send(404, {});
  });
});
await new Promise(r => srv.listen(0, r));
const base = 'http://127.0.0.1:' + srv.address().port;
const env = { FIREBASE_SA: JSON.stringify(SA), TOKEN_URL: base + '/token', FS_BASE: base + '/v1', FCM_BASE: base + '/fcm/v1' };

// 1) 7:00 po beogradskom (zimsko vreme = 6:00 UTC), minut deljiv sa 30 → i znak da robot radi
const now = Date.UTC(2026, 10, 18, 6, 0, 0);
reset(now);
const r = await tick(env, { now });
const g = k => DB.get(k);
assert.equal(r.alarmi, 2, 'dva alarma treba da zazvone (a1 i a4)');
const alarmSent = SENT.filter(m => m.webpush.data.kind === 'alarm');
assert.deepEqual(alarmSent.map(m => m.token).sort(), ['T1', 'T1'], 'alarm ide samo uređajima sa uključenim alarmima (d2 isključio, d3 mrtav)');
assert.ok(alarmSent.every(m => m.webpush.headers.Urgency === 'high' && m.webpush.data.url.includes('m=alarmi')));
assert.equal(g('alarmi/a1').nag, 1); assert.equal(g('alarmi/a1').next, now + 10 * 60000, 'ponovi za 10 min');
assert.equal(g('alarmi/a4').nag, 3); assert.equal(g('alarmi/a4').next, null, 'posle trećeg puta više ne šalje');
assert.equal(g('alarmi/a3').nag, 0, 'ugašen alarm se ne dira'); assert.equal(g('alarmi/a2').nag, 0, 'budući alarm se ne dira');
assert.ok(DELETED.includes('naprave/d3'), 'mrtav uređaj je uklonjen'); assert.equal(r.uklonjeno, 1, 'uklonjen samo jednom');
const morning = SENT.filter(m => !m.webpush.data.kind);
assert.equal(morning.length, 1, 'jutarnji spisak samo za d1 (7:00); d2 je u 9:30');
assert.match(morning[0].webpush.data.title, /hitno/); assert.equal(g('naprave/d1').lastSent, '2026-11-18');
assert.ok(g('app_meta/alarmi_robot') && g('app_meta/alarmi_robot').last === now, 'znak da robot radi');
console.log('1) alarmi + jutro: OK', JSON.stringify(r));

// 2) isti minut ponovo: ništa novo (jutro već poslato, alarmi pomereni)
SENT = [];
const r2 = await tick(env, { now: now + 1000 });
assert.equal(r2.alarmi, 0); assert.equal(SENT.length, 0);
console.log('2) ponovo isti minut: ništa ne šalje – OK');

// 3) neko je štiklirao „Urađeno“ baš između čitanja i upisa → robot ne sme da pregazi potvrdu
reset(now); BUMP.add('alarmi/a1');
await tick(env, { now: now + 60000 });
assert.equal(g('alarmi/a1').nag, 0, 'potvrda nije pregažena'); assert.equal(g('alarmi/a4').nag, 3, 'drugi alarm je upisan');
console.log('3) upis sa proverom verzije: OK');

// 4) tekst obaveštenja
const t = alarmText({ t: 'Proveri kotao', at: now, byName: 'Lidija', rep: 120, note: 'ubaci 2 džaka' }, 0);
assert.equal(t.title, '⏰ Proveri kotao'); assert.match(t.body, /zvoni od 7:00 · postavio Lidija · svaka 2 sata/);
assert.equal(alarmText({ t: 'X', at: now }, 1).title, '⏰ Još niko nije potvrdio: X');
console.log('4) tekst: OK –', JSON.stringify(t));

// 5) bez ključa
assert.deepEqual(await tick({}, { now }), { skip: 'FIREBASE_SA nije podešen' });
console.log('5) bez ključa preskače – OK');
srv.close();
console.log('Sve probe prošle.');
