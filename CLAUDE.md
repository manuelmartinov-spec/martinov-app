# Martinov aplikacija — beleške za Claude-a

Javni projekat (GitHub Pages). Ovde NIKAD ne idu privatni podaci (izvodi, PIB, računi, imena kupaca) — samo kod.
Izvor koda nije ovde: aplikacija se pravi iz izvora (`p1.html`, `p2–p11.js`, `apps/*`, PWA sloj `fb.js`, `glue.js`, `sw.js`),
a ovde se objavljuje gotov rezultat. Baza: Firebase projekat `martinov-app` (Firestore, pristup samo manuel.martinov@gmail.com).

## Most: Claude upisuje u aplikaciju (robot „Claude prijem“)
Claude ne može direktno u bazu. Zato: Claude zaključa paket javnim ključem i gurne ga ovde, a GitHub robot
(`.github/workflows/prijem.yml` → `tools/prijem.mjs`, tajna `FIREBASE_SA`) ga otključa i upiše u bazu.
- Javni ključ: `prijem/kljuc.pub.pem`. Tajni ključ postoji SAMO u bazi (`private/prijem_kljuc`); niko ga ne vidi.
- Slanje: napravi JSON paket → `node tools/claude-most.mjs zakljucaj paket.json prijem/ulaz/<GGGGMMDD-HHMM-opis>.bin`
  → commit + push. Robot upiše, obriše `.bin` i ostavi `prijem/rezultat/<id>.json` (`ok`, broj zapisa). `git pull` pa pročitaj.
- Paket: `{title, note, mod:"troskovi" (dugme „Otvori“ u obaveštenju), docs:{"kolekcija/id":{…}}, del:["kolekcija/id"], files:{id:{name,type,b64}}, priv:{kljuc:objekat}}`.
  Zapisi se upisuju ceo dokument (zamena). `private/*` i `prijem/*` se ne mogu pisati kroz `docs`.
  Fajl (PDF/slika) se upisuje kao u aplikaciji: `files/<id>` + delovi `files/<id>/c/<i>`; u zapisu ga navedi kao
  `att:[{id,name,type,size}]`. Paket drži ispod ~20 MB (više paketa za velike količine).
  Aplikacija prikaže „Claude je dodao …“ iz `prijem/<id>` (title, note).
- Čitanje (npr. provera uplata): `node tools/claude-most.mjs zahtev '{"col":["docs","manual","meta"],"deep":true,"priv":["troskovi_seed"],"files":[]}' prijem/zahtev/<id>.json /scratch/<id>.pem`
  → push → robot napravi `prijem/izvoz/<id>.bin` zaključan jednokratnim ključem → `git pull` →
  `node tools/claude-most.mjs otvori prijem/izvoz/<id>.bin /scratch/<id>.pem izvoz.json`. Tajni `.pem` drži samo u radnom
  folderu (scratchpad), nikad u projektu; posle čitanja obriši `prijem/izvoz/<id>.bin` (commit).
- `"col":["*"]` = sve kolekcije osim files/private/prijem. `deep:true` = i podkolekcije (npr. zapisi tabela).
- Dnevnik GitHub robota je javan: robot ispisuje samo brojeve, nikad sadržaj.

## Kolekcije koje Troškovi koriste
- `manual/<id>` ručni troškovi i fakture dobavljača: `{dt, who, what, cat, sub, inv, due, amt:"1234,56", cur, pay, kurs, note, att}`;
  `pay:"račun firme"` = faktura koja se plaća sa računa firme (aplikacija je sama spoji sa uplatom sa izvoda).
- `banka/<id>` stavke sa izvoda (posle izvoda 99; starije su u `private/troskovi_seed`):
  `{id:"d2026-105-1", dt, acc:"RSD|EUR|GBP", iz, dir:"out|in", amt, rsd, cur, who, pp, what, sif, ref}`.
- `izvodi/<acc>-<godina>-<broj>` (npr. `RSD-2026-105`) izvod kao dokument: `{acc, iz, dt, prev, novo, dug, pot, n, att:[PDF], ok, msg}`.
  Troškovi iz toga prave karticu Dokumenti i proveru (zbir, staro → novo stanje, lanac bez rupa).
- Izvodi stižu na Gmail (info@mail.bancaintesa.rs, „Izvod broj N računa 160-…“ i „Izvod deviznog računa … broj N“);
  Claude ih čita (RAW poruka → PDF), proverava i šalje kroz most. Dinarski izvod: kolone x (pdfplumber reči) –
  naziv 60–230, datumi 250–300, zaduženje x1≤425 / odobrenje, šifra 485–512, svrha 512–636, poziv 636–712.
  Alati (Python, pdfplumber): `tools/izvodi/extract_izvod.py OUT poruka.txt…` (Gmail RAW → PDF),
  `tools/izvodi/parse_izvod.py *.Pdf` (dinarski: zaglavlje + stavke + `ok/msg` provera), `tools/izvodi/parse_dev.py` (devizni).
  Stavka ide u `banka/d<godina>-<izvod>-<rn>` samo ako je NOVA (posle 2026/99 su u bazi; starije su u seed-u — ne dupliraj);
  PDF u `files/izvod-<acc>-<godina>-<broj>`, opis u `izvodi/<acc>-<godina>-<broj>`. Uvek proveri `ok` i lanac stanja pre slanja.
  Stanje 29.10.2026: u bazi su svi izvodi 2026 (RSD 1–105, EUR 1–4, GBP 1–2) i 2025/141; ostali 2025 PDF-ovi još nisu.
- `docs/<id>` dokumenti iz Faktura (ponuda, predračun, avans, račun) – Troškovi → Provera ih upoređuje sa uplatama.
- `settings/kalkulator` cene građe (`gradja:[{id,naziv,vrsta,deb,duz:"kratka|duga|",cena}]`) i parametri Kalkulatora (rad €/h, otpad %, marža %, +mm na dužinu, duga od mm…);
  `kalk/<id>` sačuvani proračuni, `kalk_sabloni/<id>` Manuelovi šabloni.
- `upotreba/<GGGG-Www>_<uređaj>` brojač korišćenja: `{week, dev, name, from, counts:{"Strana › kontrola":broj}}` (samo brojevi, bez sadržaja).
- `izvestaji/<id>` izveštaj koji Claude napiše (`{title, text, at, week}`); Pregled ga prikaže dok ga Manuel ne sakrije.
  Nedeljni izveštaj o korišćenju pravi zakazani zadatak (ponedeljak ujutru): čita `upotreba` kroz most, piše `izvestaji/upotreba-<GGGG-Www>`.
  Samo predlozi – aplikacija se ne menja bez Manuelovog odobrenja.
- `meta/<id stavke>` kategorija/beleška/podkategorija koju je Manuel izabrao: `{cat, note, sub}` — ne pregazi.

## Objava
Gotov rezultat se kopira ovde BEZ brisanja foldera `prijem/` i `.git` (ne kopirati `.git` iz build foldera).
