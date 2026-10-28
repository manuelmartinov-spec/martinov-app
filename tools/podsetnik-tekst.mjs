/* Tekst jutarnjeg obaveštenja — isti u aplikaciji (dugme „Probaj“) i u programu koji šalje obaveštenja.
   data = {tasks:[{title,due,hot,next}], shop:[{name,qty,unit,store,hot,for}]}  (samo otvorene stavke)
   o    = {tasks:true|false, shop:'sve'|'kuca'|'radionica'|'ne'}
   today = 'YYYY-MM-DD' (lokalni datum)
   Vraća {title, body, m, n} ili null kad nema ničega za javiti. */
function podText(data, o, today) {
  o = o || {};
  const wantT = o.tasks !== false, wantS = o.shop || 'sve';
  const days = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);
  const okD = s => /^\d{4}-\d{2}-\d{2}/.test(String(s || ''));
  const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s };
  const lines = [], cnt = { hot: 0, late: 0, today: 0, tom: 0, shop: 0 };
  if (wantT) {
    const hot = [], late = [], tod = [], tom = [];
    for (const t of (data && data.tasks) || []) {
      if (!t || !t.title) continue;
      const d = okD(t.due) ? days(String(t.due).slice(0, 10), today) : null;
      if (t.hot) hot.push([t, d]);
      else if (d === null) continue;
      else if (d < 0) late.push([t, d]);
      else if (d === 0) tod.push([t, d]);
      else if (d === 1) tom.push([t, d]);
    }
    const rel = d => d === null ? '' : d < 0 ? ' (kasni ' + (-d) + ' d.)' : d === 0 ? ' (danas)' : d === 1 ? ' (sutra)' : '';
    late.sort((a, b) => a[1] - b[1]);
    for (const [t, d] of hot) lines.push('Hitno: ' + cut(t.title, 70) + rel(d));
    for (const [t, d] of late) lines.push('Kasni ' + (-d) + ' d.: ' + cut(t.title, 70));
    for (const [t] of tod) lines.push('Danas: ' + cut(t.title, 70));
    for (const [t] of tom) lines.push('Sutra: ' + cut(t.title, 70));
    cnt.hot = hot.length; cnt.late = late.length; cnt.today = tod.length; cnt.tom = tom.length;
  }
  if (wantS !== 'ne') {
    const n = s => String(s || '').toLowerCase().replace(/ć/g, 'c');
    const items = ((data && data.shop) || []).filter(x => {
      if (!x || !x.name) return false;
      const f = n(x.for);
      if (wantS === 'kuca') return !f || f.startsWith('kuc');
      if (wantS === 'radionica') return !f || f.startsWith('radion');
      return true;
    });
    const q = x => { const a = x.qty === '' || x.qty == null ? '' : String(x.qty); return a ? ' ' + a + (x.unit ? ' ' + x.unit : '') : '' };
    const by = new Map();
    for (const x of items.filter(x => x.hot).concat(items.filter(x => !x.hot))) {
      const k = String(x.store || '').trim() || 'bilo gde';
      if (!by.has(k)) by.set(k, []);
      by.get(k).push((x.hot ? '!' : '') + cut(x.name, 40) + q(x));
    }
    for (const [k, arr] of by) lines.push('Kupiti – ' + k + ': ' + arr.join(', '));
    cnt.shop = items.length;
  }
  if (!lines.length) return null;
  const parts = [];
  if (cnt.hot) parts.push(cnt.hot + ' hitno');
  if (cnt.late) parts.push(cnt.late + ' kasni');
  if (cnt.today) parts.push(cnt.today + ' danas');
  if (cnt.tom) parts.push(cnt.tom + ' sutra');
  if (cnt.shop) parts.push(cnt.shop + ' za kupiti');
  const MAX = 7;
  const body = lines.length > MAX ? lines.slice(0, MAX - 1).concat('+ još ' + (lines.length - MAX + 1)) : lines;
  const onlyShop = !(cnt.hot || cnt.late || cnt.today || cnt.tom);
  return { title: 'Martinov – ' + parts.join(', '), body: body.join('\n'), m: onlyShop ? 'kupovina' : 'zadaci', n: lines.length };
}

export { podText };
