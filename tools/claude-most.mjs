// Alat za Claude-a (radi u Claude-ovom radnom prostoru, ne u aplikaciji): zaključava paket za robota „Claude prijem“
// i otvara izvoz koji robot vrati. Nema tajnih podataka: paket se zaključava javnim ključem iz prijem/kljuc.pub.pem,
// a za čitanje se svaki put pravi novi jednokratni par ključeva čiji tajni deo ostaje samo kod Claude-a.
//   node tools/claude-most.mjs zakljucaj paket.json prijem/ulaz/<id>.bin [prijem/kljuc.pub.pem]
//   node tools/claude-most.mjs zahtev '{"col":["docs"],"deep":true,"priv":["troskovi_seed"]}' prijem/zahtev/<id>.json /putanja/tajni.pem
//   node tools/claude-most.mjs otvori prijem/izvoz/<id>.bin /putanja/tajni.pem izvoz.json
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

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
const [cmd, a, b, c] = process.argv.slice(2);
const mk = p => fs.mkdirSync(path.dirname(p), { recursive: true });
if (cmd === 'zakljucaj') {
  const pub = fs.readFileSync(c || 'prijem/kljuc.pub.pem', 'utf8');
  const raw = fs.readFileSync(a); JSON.parse(raw.toString('utf8'));
  mk(b); fs.writeFileSync(b, seal(zlib.gzipSync(raw, { level: 9 }), pub));
  console.log('zaključano:', b, fs.statSync(b).size, 'B');
} else if (cmd === 'zahtev') {
  const spec = JSON.parse(a);
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
  mk(c); fs.writeFileSync(c, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  mk(b); fs.writeFileSync(b, JSON.stringify({ ...spec, pub: publicKey.export({ type: 'spki', format: 'pem' }), at: new Date().toISOString() }, null, 1) + '\n');
  console.log('zahtev:', b);
} else if (cmd === 'otvori') {
  const out = zlib.gunzipSync(unseal(fs.readFileSync(a), fs.readFileSync(b, 'utf8')));
  mk(c); fs.writeFileSync(c, out);
  console.log('otvoreno:', c, out.length, 'B');
} else {
  console.log('upotreba: zakljucaj | zahtev | otvori (vidi vrh fajla)'); process.exitCode = 2;
}
