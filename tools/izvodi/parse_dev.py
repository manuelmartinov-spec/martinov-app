"""Devizni izvod Banca Intesa (PDF) → zaglavlje + stavke (samo prva strana ima pregled)."""
import sys, re, json, pdfplumber
AMT = re.compile(r'^-?[\d,]+\.\d{2}$'); DATE = re.compile(r'^(\d{2})\.(\d{2})\.(\d{4})$')
num = lambda s: float(s.replace(',', ''))
def parse(path):
    with pdfplumber.open(path) as pdf:
        pg = pdf.pages[0]; ws = pg.extract_words(x_tolerance=1.5, y_tolerance=2)
    L = {}
    for w in ws: L.setdefault(round(w['top'] / 2) * 2, []).append(w)
    h = {'file': path}; rows = []
    for t in sorted(L):
        l = sorted(L[t], key=lambda w: w['x0']); tx = [w['text'] for w in l]
        if 'Statement' in tx and 'No' in tx and re.fullmatch(r'\d{7}', tx[-1]): h['iz'] = int(tx[-1][-3:]); h['year'] = int(tx[-1][:4])
        if 'Statement' in tx and 'date' in tx and DATE.match(tx[-1]): m = DATE.match(tx[-1]); h['dt'] = f'{m[3]}-{m[2]}-{m[1]}'
        if tx[:2] == ['Valuta', '/']: h['cur'] = tx[-1]
        if 'Početno' in tx: h['prev'] = num([x for x in tx if AMT.match(x)][-1])
        if 'Novo' in tx and 'stanje' in tx: h['novo'] = num([x for x in tx if AMT.match(x)][-1])
        if l and l[0]['x0'] < 35 and re.fullmatch(r'\d+', l[0]['text']) and any(AMT.match(x) for x in tx) and 'iz' in h:
            r = {'rn': int(l[0]['text']), 'deb': 0.0, 'cred': 0.0, 'rsd': 0.0}
            for w in l:
                if AMT.match(w['text']):
                    if w['x1'] <= 360: r['deb'] = num(w['text'])
                    elif w['x1'] <= 432: r['cred'] = num(w['text'])
                    elif w['x1'] <= 500: r['rsd'] = num(w['text'])
            rows.append(r)
    h['dug'] = round(sum(r['deb'] for r in rows), 2); h['pot'] = round(sum(r['cred'] for r in rows), 2); h['n'] = len(rows)
    msg = []
    if 'prev' in h and 'novo' in h and abs(h['prev'] - h['dug'] + h['pot'] - h['novo']) > 0.005: msg.append('staro stanje − duguje + potražuje ≠ novo stanje')
    if not rows: msg.append('nema stavki')
    h['ok'] = not msg; h['msg'] = '; '.join(msg)
    return {'h': h, 'rows': rows}
if __name__ == '__main__': print(json.dumps([parse(p) for p in sys.argv[1:]], ensure_ascii=False, indent=1))
