# Martinov aplikacija — beleške za Claude-a

Javni projekat (GitHub Pages). Ovde NIKAD ne idu privatni podaci (izvodi, PIB, računi, imena kupaca) — samo kod.
Do 1.6.0 aplikacija se pravila iz izvora (`p1.html`, `p2–p11.js`, `glue.js`) koji više ne postoje. Od 1.7.0 se menjaju
direktno fajlovi ovde (`index.html`, `fb.js`, `sw.js`, `apps/*`) – oni su sada izvor. Posle izmene: podigni verziju u `sw.js` (V),
`version.json` (v, date, log) i `fb.js?v=` u `index.html`; probaj u Playwright-u sa lažnom bazom (window.__fbResolve + __mtPush stub umesto fb.js). Baza: Firebase projekat `martinov-app` (Firestore, pristup samo manuel.martinov@gmail.com).

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
  Stavke `items:[{d,q,u,p,disc,opt,pc,pin}]`: `p` je UVEK u valuti dokumenta (to čitaju obračun, PDF, Troškovi, Poslovi);
  `pc`/`pin` = cena upisana u drugoj valuti (dugme € / din) – `p` se iz njih preračunava po `kurs`. `opt` boje: drvo, boja, mdf, mobr, metal, keramika, kobr, staklo, rucke, note.
- `settings/kalkulator` cene građe (`gradja:[{id,naziv,vrsta,deb,duz:"kratka|duga|",cena}]`) i parametri Kalkulatora (rad €/h, otpad %, marža %, +mm na dužinu, duga od mm…);
  `kalk/<id>` sačuvani proračuni, `kalk_sabloni/<id>` Manuelovi šabloni.
- `upotreba/<GGGG-Www>_<uređaj>` brojač korišćenja: `{week, dev, name, from, counts:{"Strana › kontrola":broj}}` (samo brojevi, bez sadržaja).
- `izvestaji/<id>` izveštaj koji Claude napiše (`{title, text, at, week}`); Pregled ga prikaže dok ga Manuel ne sakrije.
  Nedeljni izveštaj o korišćenju pravi zakazani zadatak (ponedeljak ujutru): čita `upotreba` kroz most, piše `izvestaji/upotreba-<GGGG-Www>`.
  Samo predlozi – aplikacija se ne menja bez Manuelovog odobrenja.
- `meta/<id stavke>` kategorija/beleška/podkategorija koju je Manuel izabrao: `{cat, note, sub}` — ne pregazi.

## Objava
Gotov rezultat se kopira ovde BEZ brisanja foldera `prijem/` i `.git` (ne kopirati `.git` iz build foldera).

## Alarmi (od 1.7.0)
- `alarmi/<id>` `{t, k:"kotao|lepak|farba|ostalo", at, rep (min, 0 = jednom), next, nag, on, by, byName, note, cr, up, log:[{n,a}], doneByName, doneAt, endBy, endAt, snz}`.
  `at` = kad zvoni; `next` = kad robot šalje (null = ne šalje); `nag` = koliko puta je poslao u ovom krugu. Aplikacija postavlja `next=at, nag=0`
  pri dodavanju/„Urađeno“ (ponavljanje: `at = sada + rep`)/„+10 min“, a `on:false, next:null` kad je gotov ili ugašen.
- Robot `worker/` (Cloudflare Worker „martinov-alarmi“, svakog minuta): `next ≤ sada` → FCM `data.kind="alarm"` na `naprave` sa `alarmi!==false`,
  pa `next = +10 min` (najviše 3 slanja), upis sa `currentDocument.updateTime` da ne pregazi potvrdu. Isti robot šalje jutarnji spisak tačno
  u izabrano vreme (GitHub „Jutarnji podsetnik“ ostaje kao rezerva; `lastSent` sprečava duplo). Znak života: `app_meta/alarmi_robot {last, ok, msg}`.
- Postavljanje: `.github/workflows/alarmi-robot.yml` (push na `worker/**` ili ručno) – treba GitHub tajna `CLOUDFLARE_API_TOKEN`
  (Manuelov Cloudflare nalog, token „Martinov alarmi robot“, samo Workers prava); `FIREBASE_SA` prepisuje u Cloudflare tajnu. Proba bez interneta: `node worker/proba.mjs`.
- `sw.js`: alarm sa vidljivom aplikacijom → `postMessage mt-alarm-push` (aplikacija sama zvoni); inače obaveštenje sa dugmadima done/snooze →
  `?m=alarmi&a=<id>&do=done|snooze|open`.

## Meni, pretraga, animacija (od 1.8.0)
- Levi meni = traka (`#rail`, `renderSide`/`sideGroups`): Traži, Najčešće (`favKeys`, brojač u localStorage `mt.nav`, pola za 14 dana), Pregled/Kalendar/Alarmi,
  pa kategorije (Poslovi, Novac, Kupci, Proizvodi, Nabavka, ostale, Ostalo); grupa sa 1 stavkom se otvara odmah, ostale otvaraju listu `#spanel` (`sideG`).
  Dole Dodaj (`#newT`, `#impBtn` se premeštaju u listu) i Aplikacija. Na telefonu je traka + lista u fioci.
- „Traži ili skoči na…“ (`#qk`, Ctrl K i iz ugrađenih delova preko BRIDGE → `parent.__mtQuick`): stranice, `X.docs` (→ `openInvoice`), zapisi svih tabela (→ `openRec`).
- `lib/genie.js` (u index.html i u svakom ugrađenom delu preko BRIDGE): prozor preko celog ekrana koji se pojavi posle klika izlazi iz tog dugmeta;
  pri zatvaranju se kopija uvuče nazad. Preskače `data-no-genie` i prozore koji već imaju svoju animaciju (Fakture: Uvećaj, Boje i detalji).

