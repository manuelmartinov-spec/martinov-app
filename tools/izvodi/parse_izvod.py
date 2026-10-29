"""Čita dinarski izvod Banca Intesa (PDF) → zaglavlje (stanja) + stavke u formatu Troškova.
python3 -I parse_izvod.py fajl.pdf [...]  → JSON na stdout"""
import sys, re, json, pdfplumber

AMT = re.compile(r'^-?[\d,]+\.\d{2}$')
DATE = re.compile(r'^(\d{2})\.(\d{2})\.(\d{4})\.?$')
ACC = re.compile(r'^\d{3}-\d{5,13}-\d{2}$')
num = lambda s: float(s.replace(',', ''))
iso = lambda m: f'{m.group(3)}-{m.group(2)}-{m.group(1)}'

def lines_of(page):
    ws = page.extract_words(x_tolerance=1.5, y_tolerance=2, keep_blank_chars=False)
    L = {}
    for w in ws:
        L.setdefault(round(w['top'] / 2) * 2, []).append(w)
    return [(t, sorted(L[t], key=lambda w: w['x0'])) for t in sorted(L)]

def parse(path):
    with pdfplumber.open(path) as pdf:
        pages = [lines_of(p) for p in pdf.pages]
        full = '\n'.join(p.extract_text() or '' for p in pdf.pages)
    h = {'file': path}
    L0 = pages[0]
    for t, ws in L0:
        tx = [w['text'] for w in ws]
        if tx[:2] == ['IZVOD', 'BR.']: h['iz'] = int(tx[2])
        if 'DAN' in tx:
            m = DATE.match(tx[-1]); h['dt'] = iso(m) if m else None
        if 'računa' in tx and ACC.match(tx[-1]): h['acc_no'] = tx[-1]
    # stanja (samo levo od x=540; desno je kutija sa provizijom): po koloni
    for t, ws in L0:
        if not (160 < t < 182): continue
        for w in ws:
            if w['x0'] >= 540: continue
            if AMT.match(w['text']):
                v = num(w['text']); x = w['x0']
                k = 'prev' if x < 120 else 'dug' if x < 235 else 'pot' if x < 330 else 'novo' if x < 420 else None
                if k and k not in h: h[k] = v
            elif re.fullmatch(r'\d+', w['text']) and 430 < w['x0'] < 540:
                h['n_zad' if w['x0'] < 500 else 'n_odo'] = int(w['text'])
    m = re.search(r'Ukupno\s*dinara\s*([\d,]+\.\d{2})\s*([\d,]+\.\d{2})', full)
    if m: h['tot_zad'], h['tot_odo'] = num(m.group(1)), num(m.group(2))
    m = re.search(r'\(postoji\s*(\d+)\s*naloga\)', full); h['n'] = int(m.group(1)) if m else None
    rows = []
    COLS = {'who': (60, 230), 'date': (250, 300), 'what': (512, 636), 'ref': (636, 712)}
    def clusters(lines):
        out = []
        for t, txt in lines:
            if out and t - out[-1][-1][0] <= 13: out[-1].append((t, txt))
            else: out.append([(t, txt)])
        return out
    for pi, L in enumerate(pages):
        top = next((t for t, ws in L if [w['text'] for w in ws][:2] == ['Datum', 'valute']), None)
        top = (top + 4) if top is not None else 30
        end = next((t for t, ws in L if [w['text'] for w in ws][:2] in (['Ukupno', 'za'], ['Štampano:'],)), None) or 9999
        body = [(t, ws) for t, ws in L if top < t < end and not any(w['text'] == 'Strana' for w in ws)]
        rn = [(t, int(ws[0]['text'])) for t, ws in body if ws and ws[0]['x0'] < 60 and re.fullmatch(r'\d+', ws[0]['text'])]
        items = []
        for y, k in rn:
            it = {'rn': k, 'y': y, 'who': [], 'date': [], 'what': [], 'ref': [], 'pp': '', 'sif': '', 'zad': None, 'odo': None}
            for t, ws in body:
                if abs(t - y) > 3: continue
                for w in ws:
                    if AMT.match(w['text']) and 300 <= w['x0'] < 490:
                        if w['x1'] <= 425: it['zad'] = num(w['text'])
                        else: it['odo'] = num(w['text'])
                    elif 485 <= w['x0'] < 512 and re.fullmatch(r'\d{3}', w['text']): it['sif'] = w['text']
            items.append(it)
        for col, (a, b) in COLS.items():
            lines = []
            for t, ws in body:
                tx = [w['text'] for w in ws if a <= w['x0'] < b]
                if col == 'date': tx = [x for x in tx if DATE.match(x)]
                if tx: lines.append((t, ' '.join(tx)))
            parts = []
            for cl in clusters(lines):
                ys = [it['y'] for it in items if cl[0][0] - 3 <= it['y'] <= cl[-1][0] + 3]
                for ya, yb in zip(ys, ys[1:]):  # klaster preko više stavki: podeli na najvećem razmaku između njih
                    idx = [i for i in range(len(cl) - 1) if ya - 3 <= cl[i][0] and cl[i + 1][0] <= yb + 3]
                    if not idx: continue
                    # tekst u ćeliji je centriran na red stavke: podela kod koje je svaki deo najbliže svom redu
                    cen = lambda P: (P[0][0] + P[-1][0]) / 2
                    g = min(idx, key=lambda i: abs(cen(cl[:i + 1]) - ya) + abs(cen(cl[i + 1:]) - yb) - 0.01 * (cl[i + 1][0] - cl[i][0]))
                    parts.append(cl[:g + 1]); cl = cl[g + 1:]
                parts.append(cl)
            for cl in parts:
                if not cl: continue
                c = (cl[0][0] + cl[-1][0]) / 2
                if pi > 0 and rows and (not items or c < items[0]['y'] - 22): tgt = rows[-1]
                elif items: tgt = min(items, key=lambda it: abs(it['y'] - c))
                else: continue
                for t, txt in cl:
                    if col == 'who':
                        parts = txt.split(' ')
                        accs = [x for x in parts if ACC.match(x)]
                        if accs: tgt['pp'] = accs[-1]
                        txt = ' '.join(x for x in parts if not ACC.match(x) and not DATE.match(x))
                        if not txt: continue
                    tgt[col].append(txt)
        rows.extend(items)
    for r in rows:
        d = [iso(DATE.match(x)) for x in r['date']]
        r['dt'] = d[1] if len(d) > 1 else (d[0] if d else h.get('dt'))
        r['dir'] = 'out' if r['zad'] is not None else 'in'
        r['amt'] = r['zad'] if r['zad'] is not None else r['odo']
        r['who'] = re.sub(r'(,\s*-)+$|,$', '', ' '.join(r['who'])).strip()
        r['what'] = ' '.join(r['what']); r['ref'] = ' '.join(r['ref'])
        for k in ('y', 'date', 'zad', 'odo'): r.pop(k)
    # provera: zbir stavki = dnevni promet, preth ± promet = novo, broj stavki
    sz = round(sum(r['amt'] for r in rows if r['dir'] == 'out'), 2); so = round(sum(r['amt'] for r in rows if r['dir'] == 'in'), 2)
    msg = []
    if 'dug' in h and abs(sz - h['dug']) > 0.005: msg.append(f'zbir zaduženja {sz} ≠ {h["dug"]}')
    if 'pot' in h and abs(so - h['pot']) > 0.005: msg.append(f'zbir odobrenja {so} ≠ {h["pot"]}')
    if 'prev' in h and 'dug' in h and abs(h['prev'] - h['dug'] + h['pot'] - h['novo']) > 0.005: msg.append('staro stanje − duguje + potražuje ≠ novo stanje')
    if h.get('n') is not None and h['n'] != len(rows): msg.append(f'stavki {len(rows)} ≠ {h["n"]}')
    if any(r['amt'] is None for r in rows): msg.append('stavka bez iznosa')
    h['ok'] = not msg; h['msg'] = '; '.join(msg)
    return {'h': h, 'rows': rows}

if __name__ == '__main__':
    print(json.dumps([parse(p) for p in sys.argv[1:]], ensure_ascii=False, indent=1))
