(() => {
  document.documentElement.lang = 'he';
  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const TODAY = iso(new Date());

  function defaultStart() {
    const d = new Date(); d.setDate(d.getDate() + 14);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    return iso(d);
  }
  function exampleProject() {
    const p = clone(Engine.DEFAULT_PROJECT);
    p.client = 'לקוח לדוגמה'; p.address = 'רמת גן';
    p.startDate = defaultStart();
    return p;
  }

  // ---------- storage (per-viewer convenience only) ----------
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  function mergePrices(saved) {
    const p = clone(Engine.DEFAULT_PRICES);
    if (saved) for (const g of ['labor', 'material']) for (const k in p[g]) if (Number.isFinite(saved?.[g]?.[k])) p[g][k] = saved[g][k];
    return p;
  }

  const state = {
    project: store.get('bq.project') || exampleProject(),
    prices: mergePrices(store.get('bq.prices')),
    aiFields: new Set(),
    result: null,
  };

  // ---------- formatting ----------
  const nf0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
  const ils = n => '₪' + nf0.format(Math.round(n));
  const ils2 = n => '₪' + nf2.format(n);
  const dfmt = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const dshort = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const dlong = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const D = s => new Date(s + 'T00:00:00Z');
  const fd = s => s ? dfmt.format(D(s)) : '';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- form <-> project ----------
  const fields = [...document.querySelectorAll('#proj [data-path]')];
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; ks.slice(0, -1).forEach(k => { x[k] = x[k] || {}; x = x[k]; }); x[ks.at(-1)] = v; };

  function writeForm() {
    for (const el of fields) {
      const v = getPath(state.project, el.dataset.path);
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v ?? '';
      el.classList.toggle('ai-filled', state.aiFields.has(el.dataset.path));
    }
  }
  function readForm() {
    const p = clone(state.project);
    for (const el of fields) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if ('num' in el.dataset) v = el.value === '' ? NaN : Number(el.value);
      setPath(p, el.dataset.path, v);
    }
    return p;
  }
  let t;
  for (const el of fields) {
    el.addEventListener('input', () => {
      if (state.aiFields.delete(el.dataset.path)) el.classList.remove('ai-filled');
      clearTimeout(t); t = setTimeout(() => { state.project = readForm(); recompute(); }, 120);
    });
    el.addEventListener('change', () => { state.project = readForm(); recompute(); });
  }
  $('btn-reset').onclick = () => { state.project = exampleProject(); state.aiFields.clear(); writeForm(); recompute(); toast('הטופס אופס לנתוני הדוגמה.'); };
  $('btn-approve').onclick = () => { state.aiFields.clear(); writeForm(); recompute(); toast('כל השדות אושרו.'); };

  // ---------- compute + render ----------
  function recompute() {
    store.set('bq.project', state.project);
    const r = Engine.compute(state.project, state.prices, TODAY);
    const errEl = $('errors');
    if (r.errors.length) {
      errEl.innerHTML = r.errors.map(e => `<li>${esc(e)}</li>`).join('');
      errEl.hidden = false;
      return;
    }
    errEl.hidden = true;
    state.result = r;
    renderApprove(); renderSummary(); renderQuote(); renderSchedule(); renderOrders(); renderSupplier();
  }

  function renderApprove() {
    const n = state.aiFields.size;
    $('approve').hidden = n === 0;
    $('approve-msg').textContent = `${n} שדות מולאו על ידי AI ומסומנים בצהוב. ההצעה נשארת טיוטה עד שתבדוק אותם.`;
    const st = $('quote-state');
    st.textContent = n ? 'טיוטה, ממתין לאישור שדות' : 'מחושבת מנתונים מאושרים';
    st.className = 'tag ' + (n ? 'draft' : 'ok');
  }

  function renderSummary() {
    const { quote: q, schedule: s, orders: o, geometry: g } = state.result;
    const late = o.filter(x => x.late).length;
    $('summary').innerHTML = `
      <div><div class="k">סה"כ כולל מע"מ</div><div class="v">${ils(q.total)}</div><div class="s">עבודה ${ils(q.labor)} · חומרים ${ils(q.material)}</div></div>
      <div><div class="k">סיום משוער</div><div class="v">${dshort.format(D(s.finish))}</div><div class="s">${s.workdays} ימי עבודה מ-${dshort.format(D(s.phases[0].start))}</div></div>
      <div><div class="k">שטחים</div><div class="v"><span class="num">${nf2.format(g.floor)}</span> <span class="small">מ"ר</span></div><div class="s">רצפה · חיפוי <span class="num">${nf2.format(g.wallTile)}</span> · איטום <span class="num">${nf2.format(g.waterproof)}</span></div></div>
      <div><div class="k">הזמנות חומרים</div><div class="v">${o.length}</div><div class="s">${late ? `<span class="tag late">${late} באיחור</span>` : 'הכול בזמן'}</div></div>`;
    const tc = $('t-orders');
    tc.innerHTML = 'הזמנות חומרים' + (late ? ` <span class="count">${late}</span>` : '');
  }

  function renderQuote() {
    const q = state.result.quote;
    let h = `<thead><tr><th>תיאור</th><th>סוג</th><th class="n">כמות</th><th>יח'</th><th class="n">מחיר יח'</th><th class="n">סה"כ</th></tr></thead><tbody>`;
    q.chapters.forEach((c, i) => {
      h += `<tr class="chapter"><td colspan="5">${i + 1}. ${esc(c.name)}</td><td class="n">${ils(c.subtotal)}</td></tr>`;
      for (const l of c.lines) h += `<tr><td>${esc(l.name)}</td><td><span class="kind ${l.kind === 'חומר' ? 'm' : ''}">${l.kind}</span></td><td class="n">${nf2.format(l.qty)}</td><td>${esc(l.unit)}</td><td class="n">${ils2(l.unitPrice)}</td><td class="n">${ils(l.total)}</td></tr>`;
    });
    h += `</tbody><tfoot>
      <tr><td colspan="5">עבודה</td><td class="n">${ils(q.labor)}</td></tr>
      <tr><td colspan="5">חומרים (כולל תוספת ${state.project.materialMarkupPct || 0}%)</td><td class="n">${ils(q.material)}</td></tr>
      <tr><td colspan="5">סה"כ לפני מע"מ</td><td class="n">${ils(q.net)}</td></tr>
      <tr><td colspan="5">מע"מ ${state.project.vatPct}%</td><td class="n">${ils(q.vat)}</td></tr>
      <tr class="grand"><td colspan="5">סה"כ לתשלום</td><td class="n">${ils(q.total)}</td></tr></tfoot>`;
    $('quote-table').innerHTML = h;
  }

  function renderSchedule() {
    const s = state.result.schedule;
    const raw = s.phases;
    const lo = D(raw[0].start).getTime();
    const hiS = raw.reduce((m, p) => [p.end, p.waitUntil].filter(Boolean).reduce((a, b) => a > b ? a : b, m), raw[0].end);
    const DAY = 864e5;
    const total = (D(hiS).getTime() - lo) / DAY + 1;
    const pos = s => ((D(s).getTime() - lo) / DAY) / total * 100;
    const span = (a, b) => ((D(b).getTime() - D(a).getTime()) / DAY + 1) / total * 100;
    // ticks every Sunday
    let ticks = '';
    for (let x = lo; x <= D(hiS).getTime(); x += DAY) { const d = new Date(x); if (d.getUTCDay() === 0) { const p = (x - lo) / DAY / total * 100; ticks += `<div class="tick" style="inset-inline-start:${p}%">${dshort.format(d)}</div>`; } }
    const grids = ticks.replace(/class="tick"/g, 'class="grid"').replace(/>[^<]*</g, '><');
    // phases delayed by material arrival (gap after deps)
    let h = `<div class="lbl muted small">שלב</div><div class="axis">${ticks}</div>`;
    const depFree = {};
    for (const p of raw) depFree[p.id] = p.waitUntil || p.end;
    for (const p of raw) {
      const ph = Engine.PHASES.find(x => x.id === p.id);
      const deps = ph.deps.filter(d => depFree[d]);
      const ready = deps.length ? deps.map(d => depFree[d]).sort().at(-1) : p.start;
      // a gap of more than 3 calendar days beyond readiness means it waits on a material
      const waitingMat = (D(p.start) - D(ready)) / DAY > 3;
      h += `<div class="lbl" title="${esc(p.name)}">${esc(p.name)}</div><div class="track">${grids}`;
      if (waitingMat) h += `<div class="bar crit" style="inset-inline-start:${pos(ready)}%;width:${span(ready, p.start) - 100 / total}%;height:6px;top:14px" title="ממתין לחומר"></div>`;
      h += `<div class="bar" style="inset-inline-start:${pos(p.start)}%;width:${span(p.start, p.end)}%" title="${fd(p.start)} עד ${fd(p.end)}"></div>`;
      if (p.waitUntil) { const ws = new Date(D(p.end).getTime() + DAY); h += `<div class="wait" style="inset-inline-start:${pos(iso2(ws))}%;width:${Math.max(0, pos(p.waitUntil) - pos(iso2(ws)))}%" title="${esc(p.waitName)}"></div>`; }
      h += `</div>`;
    }
    $('gantt').innerHTML = h;
    let tb = `<thead><tr><th>שלב</th><th>התחלה</th><th>סיום</th><th class="n">ימי עבודה</th><th>אחרי השלב</th></tr></thead><tbody>`;
    for (const p of raw) tb += `<tr><td>${esc(p.name)}</td><td>${fd(p.start)}</td><td>${fd(p.end)}</td><td class="n">${p.days}</td><td class="muted">${p.waitUntil ? esc(p.waitName) + ', עד ' + fd(p.waitUntil) : ''}</td></tr>`;
    tb += `</tbody><tfoot><tr class="grand"><td>מסירה</td><td colspan="4">${dlong.format(D(s.finish))}</td></tr></tfoot>`;
    $('sched-table').innerHTML = tb;
  }
  const iso2 = d => d.toISOString().slice(0, 10);

  function renderOrders() {
    const o = state.result.orders;
    let h = `<thead><tr><th>להזמין עד</th><th>פריט</th><th class="n">כמות</th><th>ספק</th><th>נדרש באתר</th><th>לשלב</th><th>מצב</th></tr></thead><tbody>`;
    for (const x of o) {
      const status = x.late ? '<span class="tag late">עבר מועד ההזמנה</span>' : x.note ? `<span class="tag">${esc(x.note)}</span>` : '<span class="tag ok">בזמן</span>';
      h += `<tr class="${x.late ? 'late' : ''}"><td>${fd(x.orderBy)}</td><td>${esc(x.name)}<div class="small muted">נטו <span class="num">${nf2.format(x.netQty)}</span> ${esc(x.unit)}${x.waste ? `, פחת ${Math.round(x.waste * 100)}%` : ''} · אספקה ${x.lead} ימי עבודה</div></td><td class="n">${x.packs} ${esc(x.packName)}</td><td>${esc(x.supplier)}</td><td>${fd(x.needBy)}</td><td>${esc(x.phase)}</td><td>${status}</td></tr>`;
    }
    $('orders-table').innerHTML = h + '</tbody>';
    const sel = $('supplier-sel');
    const cur = sel.value;
    const sups = [...new Set(o.map(x => x.supplier))];
    sel.innerHTML = sups.map(s => `<option>${esc(s)}</option>`).join('');
    if (sups.includes(cur)) sel.value = cur;
  }

  function supplierLines() { return state.result.orders.filter(x => x.supplier === $('supplier-sel').value); }
  function renderSupplier() {
    const p = state.project, lines = supplierLines();
    if (!lines.length) { $('order-text').value = ''; return; }
    const byDate = {};
    for (const l of lines) (byDate[l.deliverBy] = byDate[l.deliverBy] || []).push(l);
    let txt = `שלום, הזמנה עבור שיפוץ חדר רחצה\n${p.client ? 'לקוח: ' + p.client + '\n' : ''}${p.address ? 'כתובת אספקה: ' + p.address + '\n' : ''}\n`;
    for (const d of Object.keys(byDate).sort()) {
      txt += `לאספקה עד ${fd(d)}:\n`;
      for (const l of byDate[d]) txt += `• ${l.name}: ${l.packs} ${l.packName}${l.unit === 'מ"ר' ? ` (${nf2.format(l.packs * l.packSize)} מ"ר)` : ''}\n`;
      txt += '\n';
    }
    txt += 'אשמח לאישור מחיר וזמינות. תודה!';
    $('order-text').value = txt;
  }
  $('supplier-sel').onchange = renderSupplier;

  // ---------- prices tab ----------
  function renderPrices() {
    const L = Engine.LABOR_NAMES, M = Engine.MATERIALS;
    let a = `<thead><tr><th>עבודה</th><th>יח'</th><th class="n">מחיר</th></tr></thead><tbody>`;
    for (const k in state.prices.labor) a += `<tr><td>${esc(L[k][0])}</td><td>${esc(L[k][1])}</td><td class="n"><input type="number" min="0" step="1" id="pl-${k}" data-g="labor" data-k="${k}" value="${state.prices.labor[k]}" aria-label="${esc(L[k][0])}"></td></tr>`;
    $('labor-prices').innerHTML = a + '</tbody>';
    let b = `<thead><tr><th>חומר</th><th>מחיר ל-</th><th class="n">מחיר</th></tr></thead><tbody>`;
    for (const k in state.prices.material) { const m = M[k]; b += `<tr><td>${esc(m.name)}</td><td>${m.unit === 'מ"ר' ? 'מ"ר' : esc(m.packName) + (m.pack > 1 ? ' ' + m.pack + ' ' + m.unit : '')}</td><td class="n"><input type="number" min="0" step="1" id="pm-${k}" data-g="material" data-k="${k}" value="${state.prices.material[k]}" aria-label="${esc(m.name)}"></td></tr>`; }
    $('mat-prices').innerHTML = b + '</tbody>';
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (!el.dataset || !el.dataset.g) return;
    const v = Number(el.value);
    if (!Number.isFinite(v) || v < 0) return;
    state.prices[el.dataset.g][el.dataset.k] = v;
    store.set('bq.prices', state.prices);
    recompute();
  });
  $('btn-reset-prices').onclick = () => { state.prices = clone(Engine.DEFAULT_PRICES); store.del('bq.prices'); renderPrices(); recompute(); toast('המחירון חזר למחירי הדוגמה.'); };

  // ---------- tabs ----------
  function tabs(sel, attr, prefix) {
    const bs = [...document.querySelectorAll(sel)];
    bs.forEach(b => b.addEventListener('click', () => {
      bs.forEach(x => { x.setAttribute('aria-selected', x === b); $(prefix + x.dataset[attr]).hidden = x !== b; });
    }));
  }
  tabs('[data-out]', 'out', 'out-');
  tabs('[data-in]', 'in', 'in-');

  // ---------- toast / copy / download ----------
  let tt;
  function toast(m) { const el = $('toast'); el.textContent = m; clearTimeout(tt); tt = setTimeout(() => el.textContent = '', 4000); }
  async function copy(text, fallbackEl) {
    try { await navigator.clipboard.writeText(text); toast('הועתק.'); }
    catch { if (fallbackEl) { fallbackEl.focus(); fallbackEl.select(); toast('ההעתקה האוטומטית חסומה כאן. הטקסט מסומן, אפשר להעתיק ידנית.'); } else toast('ההעתקה חסומה בתצוגה הזו.'); }
  }
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\n');
  function save(filename, data) {
    try {
      const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('הקובץ ירד.');
    } catch { toast('לא הצלחתי להוריד את הקובץ.'); }
  }
  function quoteText() {
    const p = state.project, q = state.result.quote;
    let s = `הצעת מחיר – שיפוץ חדר רחצה\n${p.client || ''}${p.address ? ', ' + p.address : ''}\n\n`;
    q.chapters.forEach((c, i) => { s += `${i + 1}. ${c.name} – ${ils(c.subtotal)}\n`; c.lines.forEach(l => s += `   ${l.name}: ${nf2.format(l.qty)} ${l.unit} × ${ils2(l.unitPrice)} = ${ils(l.total)}\n`); });
    s += `\nסה"כ לפני מע"מ: ${ils(q.net)}\nמע"מ ${p.vatPct}%: ${ils(q.vat)}\nסה"כ לתשלום: ${ils(q.total)}\nתחילת עבודה: ${fd(state.result.schedule.phases[0].start)} · מסירה משוערת: ${fd(state.result.schedule.finish)}\n`;
    return s;
  }
  $('btn-copy-quote').onclick = () => copy(quoteText());
  $('btn-csv-quote').onclick = () => {
    const rows = [['פרק', 'תיאור', 'סוג', 'כמות', 'יחידה', 'מחיר יחידה', 'סה"כ']];
    state.result.quote.chapters.forEach(c => c.lines.forEach(l => rows.push([c.name, l.name, l.kind, l.qty, l.unit, l.unitPrice, l.total])));
    const q = state.result.quote;
    rows.push([], ['', 'סה"כ לפני מע"מ', '', '', '', '', q.net], ['', 'מע"מ', '', '', '', '', q.vat], ['', 'סה"כ לתשלום', '', '', '', '', q.total]);
    save('הצעת-מחיר-חדר-רחצה.csv', toCsv(rows));
  };
  $('btn-copy-order').onclick = () => copy($('order-text').value, $('order-text'));
  $('btn-csv-order').onclick = () => {
    const rows = [['פריט', 'כמות', 'אריזה', 'כמות נטו', 'יחידה', 'לאספקה עד', 'ספק']];
    supplierLines().forEach(l => rows.push([l.name, l.packs, l.packName, l.netQty, l.unit, l.deliverBy, l.supplier]));
    save('הזמנה-' + $('supplier-sel').value + '.csv', toCsv(rows));
  };


  // ---------- AI: shared ----------
  const ENUMS = {
    'spec.scope': ['full', 'partial'], 'spec.fixture': ['shower', 'bath'], 'spec.toilet': ['wall', 'floor'],
    'spec.waterproofing': ['cement', 'pu'], 'spec.ceiling': ['none', 'gypsum'], 'spec.drain': ['channel', 'point'],
  };
  const RANGES = {
    'room.length': [0.8, 8], 'room.width': [0.8, 8], 'room.height': [2, 4], 'room.wallTileHeight': [0.5, 4],
    'room.doorWidth': [0.5, 1.5], 'room.doorHeight': [1.8, 2.6], 'room.windowWidth': [0, 3], 'room.windowHeight': [0, 2.5],
  };
  const BOOLS = ['spec.vanity', 'spec.newPlumbing', 'spec.newElectrical'];
  const TILE = /^\d{2,3}\s*[x×*]\s*\d{2,3}$/;
  // סדר השדות בטבלת ההשוואה
  const FIELD_ORDER = ['client', 'address', 'startDate', ...Object.keys(RANGES), ...Object.keys(ENUMS), 'spec.floorTile', 'spec.wallTile', ...BOOLS];

  const SCHEMA = `{
  "client": string, "address": string, "startDate": "YYYY-MM-DD",
  "room": { "length": m, "width": m, "height": m, "wallTileHeight": m, "doorWidth": m, "doorHeight": m, "windowWidth": m, "windowHeight": m },
  "spec": { "scope": "full"|"partial", "fixture": "shower"|"bath", "toilet": "wall"|"floor", "vanity": boolean, "floorTile": "60x60", "wallTile": "30x60", "waterproofing": "cement"|"pu", "newPlumbing": boolean, "newElectrical": boolean, "ceiling": "none"|"gypsum", "drain": "channel"|"point" },
  "assumptions": [string],
  "questions": [string]
}`;
  const RULES = `You convert an Israeli renovation contractor's input about ONE bathroom renovation into structured data for a deterministic quoting engine. Never calculate quantities or prices. Do not use any tools and do not read or write files.
Return ONLY one JSON object of this shape, with no text before or after it:
${SCHEMA}
Rules:
- Include a field ONLY if the input states it or strongly implies it. Omit everything else; never invent a dimension.
- All dimensions in meters (convert cm: 240 -> 2.4). Room length is the longer side.
- scope "full" = demolishing existing tiles; "partial" = no demolition. fixture "shower" = shower with glass; "bath" = bathtub.
- If tiles go "to the ceiling", wallTileHeight = ceiling height.
- startDate: resolve relative dates ("beginning of December") against today, ${TODAY}; pick the first Sunday of that period.
- "assumptions": short Hebrew sentences, one per field you inferred rather than read directly, naming the field and why.
- "questions": up to 5 short Hebrew questions the contractor must still confirm for an accurate quote, most important first (e.g. missing door size, tile height, who supplies fixtures).`;

  // מוציא JSON מתשובה שאולי עטופה בטקסט או בגדר קוד
  function parseJson(text) {
    const s = String(text || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const cands = [s, fence && fence[1]].filter(Boolean);
    for (const c of cands) { try { return JSON.parse(c.trim()); } catch {} }
    const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
    throw { code: 'invalid_json', raw: s };
  }

  // בודק את מה שהמודל החזיר. רק ערכים שעוברים נכנסים לחישוב.
  function validateExtraction(obj) {
    const values = {}, rejected = [];
    if (typeof obj.client === 'string' && obj.client.trim()) values.client = obj.client.trim().slice(0, 80);
    if (typeof obj.address === 'string' && obj.address.trim()) values.address = obj.address.trim().slice(0, 120);
    if (typeof obj.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.startDate) && !isNaN(Date.parse(obj.startDate))) values.startDate = obj.startDate;
    for (const [path, [lo, hi]] of Object.entries(RANGES)) {
      const v = getPath(obj, path);
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= lo && n <= hi) values[path] = Math.round(n * 100) / 100;
      else rejected.push(`${path}: ${v}`);
    }
    for (const [path, opts] of Object.entries(ENUMS)) { const v = getPath(obj, path); if (v === undefined) continue; if (opts.includes(v)) values[path] = v; else rejected.push(`${path}: ${v}`); }
    for (const path of BOOLS) { const v = getPath(obj, path); if (typeof v === 'boolean') values[path] = v; }
    for (const path of ['spec.floorTile', 'spec.wallTile']) { const v = getPath(obj, path); if (v === undefined) continue; if (typeof v === 'string' && TILE.test(v.trim())) values[path] = v.trim().replace(/\s+/g, '').replace(/[×*]/g, 'x'); else rejected.push(`${path}: ${v}`); }
    const strs = k => Array.isArray(obj[k]) ? obj[k].filter(x => typeof x === 'string').slice(0, 8) : [];
    return { values, rejected, assumptions: strs('assumptions'), questions: strs('questions').slice(0, 5) };
  }

  function applyValues(v) {
    const p = clone(state.project);
    const changed = Object.keys(v);
    for (const path of changed) setPath(p, path, v[path]);
    if (p.room.wallTileHeight > p.room.height) { p.room.wallTileHeight = p.room.height; if (!changed.includes('room.wallTileHeight')) changed.push('room.wallTileHeight'); }
    state.project = p;
    changed.forEach(c => state.aiFields.add(c));
    writeForm(); recompute();
    return changed;
  }

  // ---------- AI: calling the local CLIs through the server ----------
  let providers = [];
  const providerLabel = id => providers.find(p => p.id === id)?.label || id;
  const secs = ms => (ms / 1000).toFixed(1) + ' שנ\'';
  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Kablanchik': '1' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { location.reload(); throw { code: 'auth', message: 'צריך להתחבר מחדש.' }; }
    if (!r.ok) throw { code: 'server', message: 'השרת המקומי החזיר שגיאה ' + r.status };
    return r.json();
  }
  // מחזיר {ok, ms, text} או {ok:false, error}
  async function ask(provider, prompt) {
    try { return await api('/api/ai', { provider, prompt }); }
    catch (e) { return { ok: false, ms: 0, error: e.message || 'השרת המקומי לא עונה. הוא רץ? (npm start)' }; }
  }
  async function extract(provider, txt) {
    const r = await ask(provider, `${RULES}\n\nContractor's description (Hebrew):\n"""\n${txt}\n"""`);
    if (!r.ok) return { provider, ok: false, ms: r.ms, error: r.error };
    try {
      const obj = parseJson(r.text);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw { code: 'invalid_json', raw: r.text };
      return { provider, ok: true, ms: r.ms, ...validateExtraction(obj) };
    } catch (e) {
      return { provider, ok: false, ms: r.ms, error: 'התשובה לא הגיעה כ-JSON תקין.\n' + String(e.raw || r.text || '').slice(0, 300) };
    }
  }

  function showAi(html, err) { const el = $('ai-status'); el.hidden = false; el.className = 'ai-out' + (err ? ' err' : ''); el.innerHTML = html; }
  function notesHtml(x) {
    let h = '';
    if (x.assumptions.length) h += `<div style="margin-top:8px">הנחות:</div><ul>${x.assumptions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    if (x.questions.length) h += `<div style="margin-top:8px">כדאי לברר:</div><ul>${x.questions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    if (x.rejected.length) h += `<div style="margin-top:8px" class="small">ערכים שנדחו כי הם מחוץ לטווח סביר: ${esc(x.rejected.join(', '))}</div>`;
    return h;
  }
  function reportApplied(x, changed) {
    showAi(`<strong>${esc(providerLabel(x.provider))} מילא ${changed.length} שדות</strong> (${secs(x.ms)}). הם מסומנים בצהוב בטופס. בדוק אותם לפני שליחת ההצעה.` + notesHtml(x));
  }
  const descText = () => $('free-text').value.trim().slice(0, 6000);
  let busy = false;
  function setBusy(b) { busy = b; ['btn-text', 'btn-compare', 'btn-review'].forEach(id => { $(id).disabled = b || !anyAvailable(); }); }
  const anyAvailable = () => providers.some(p => p.available);

  $('btn-text').onclick = async () => {
    const txt = descText(); if (!txt) { showAi('כתוב תיאור קודם.', true); return; }
    const prov = $('provider').value;
    setBusy(true);
    showAi(`${esc(providerLabel(prov))} מנתח את התיאור… בדרך כלל 5-30 שניות.`);
    const x = await extract(prov, txt);
    setBusy(false);
    if (!x.ok) { showAi(esc(x.error), true); return; }
    reportApplied(x, applyValues(x.values));
  };

  // ---------- compare ----------
  let lastCompare = [];
  function fieldLabel(path) {
    const el = document.querySelector(`[data-path="${path}"]`);
    const lab = el && document.querySelector(`label[for="${el.id}"]`);
    return lab ? lab.textContent.trim() : path;
  }
  function fieldValue(path, v) {
    if (v === undefined) return '';
    if (typeof v === 'boolean') return v ? 'כן' : 'לא';
    const el = document.querySelector(`[data-path="${path}"]`);
    if (el && el.tagName === 'SELECT') { const o = [...el.options].find(o => o.value === v); if (o) return o.textContent; }
    if (path === 'startDate') return fd(v);
    return String(v);
  }
  function renderCompare() {
    const rs = lastCompare;
    let h = `<thead><tr><th>שדה</th>${rs.map((r, i) => `<th>${esc(providerLabel(r.provider))}<span class="ms">${r.ms ? secs(r.ms) : ''}</span>${r.ok ? `<button class="btn small" data-apply="${i}" style="margin-top:4px">החל</button>` : ''}</th>`).join('')}</tr></thead><tbody>`;
    const okRs = rs.filter(r => r.ok);
    const errRow = rs.some(r => !r.ok);
    if (errRow) h += `<tr><td>שגיאה</td>${rs.map(r => r.ok ? '<td></td>' : `<td class="err">${esc(r.error)}</td>`).join('')}</tr>`;
    let agree = 0, total = 0;
    for (const path of FIELD_ORDER) {
      const vals = okRs.map(r => r.values[path]);
      if (vals.every(v => v === undefined) && !okRs.some(r => r.rejected.some(s => s.startsWith(path + ': ')))) continue;
      total++;
      const shown = okRs.map(r => JSON.stringify(r.values[path]));
      const diff = new Set(shown).size > 1;
      if (!diff) agree++;
      h += `<tr><td class="${diff ? 'diff' : ''}">${esc(fieldLabel(path))}</td>${rs.map(r => {
        if (!r.ok) return '<td></td>';
        const v = r.values[path];
        const rej = r.rejected.find(s => s.startsWith(path + ': '));
        if (v === undefined && rej) return `<td class="err ${diff ? 'diff' : ''}">נדחה: ${esc(rej.slice(path.length + 2))}</td>`;
        return v === undefined ? `<td class="miss ${diff ? 'diff' : ''}">לא מולא</td>` : `<td class="${diff ? 'diff' : ''}">${esc(fieldValue(path, v))}</td>`;
      }).join('')}</tr>`;
    }
    h += `</tbody><tfoot><tr><td colspan="${rs.length + 1}" class="small muted">${okRs.length > 1 ? `הסכמה מלאה ב-${agree} מתוך ${total} שדות.` : ''}</td></tr></tfoot>`;
    const t = $('compare-table'); t.className = 'cmp'; t.innerHTML = h;
    $('compare-notes').innerHTML = okRs.map(r => `<details class="pnotes"><summary>${esc(providerLabel(r.provider))}: הנחות ושאלות</summary>${notesHtml(r) || '<p class="small muted" style="margin:6px 0 0">אין.</p>'}</details>`).join('');
    t.querySelectorAll('[data-apply]').forEach(b => b.onclick = () => {
      const x = rs[Number(b.dataset.apply)];
      reportApplied(x, applyValues(x.values));
      toast(`הערכים של ${providerLabel(x.provider)} הוחלו על הטופס.`);
    });
  }
  $('btn-compare').onclick = async () => {
    const txt = descText(); if (!txt) { showAi('כתוב תיאור קודם.', true); return; }
    const avail = providers.filter(p => p.available);
    if (avail.length < 2) { showAi('צריך לפחות שני מודלים מותקנים כדי להשוות. ראה README.', true); return; }
    setBusy(true);
    $('compare-panel').hidden = false;
    lastCompare = avail.map(p => ({ provider: p.id, ok: false, ms: 0, error: 'מריץ…' }));
    renderCompare();
    showAi(`מריץ את ${avail.map(p => esc(p.label)).join(', ')} במקביל…`);
    await Promise.all(avail.map(async (p, i) => { lastCompare[i] = await extract(p.id, txt); renderCompare(); }));
    setBusy(false);
    showAi('ההשוואה מוכנה. בחר "החל" על התוצאה שאתה רוצה להכניס לטופס.');
    $('compare-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  $('btn-close-compare').onclick = () => { $('compare-panel').hidden = true; };

  // ---------- AI: review of the computed quote ----------
  $('btn-review').onclick = async () => {
    const box = $('review'); box.hidden = false;
    const prov = $('provider').value;
    setBusy(true);
    box.innerHTML = `<p class="muted small" style="margin:0">${esc(providerLabel(prov))} בודק את ההצעה…</p>`;
    const r = state.result;
    const brief = {
      spec: state.project.spec, room: state.project.room, geometry: r.geometry,
      lines: r.quote.chapters.flatMap(c => c.lines.map(l => `${c.name} | ${l.kind} | ${l.name} | ${l.qty} ${l.unit}`)),
      schedule: r.schedule.phases.map(p => `${p.name}: ${p.start} → ${p.end}${p.waitUntil ? ' + ' + p.waitName : ''}`),
      lateOrders: r.orders.filter(o => o.late).map(o => o.name),
    };
    const res = await ask(prov, `You review a bathroom-renovation quote produced by a deterministic engine for an Israeli contractor. Do not use any tools. Do NOT recompute or restate prices. Point out only concrete issues: likely missing work items or materials, risky spec choices, sequencing problems, quantities that look off for the given dimensions, and late orders. Reply with ONLY a JSON array of at most 6 objects {"level":"warn"|"info","text": short Hebrew sentence}. Data:\n${JSON.stringify(brief)}`);
    setBusy(false);
    if (!res.ok) { box.innerHTML = `<p class="small" style="margin:0;color:var(--late);white-space:pre-wrap">${esc(res.error)}</p>`; return; }
    let notes;
    try { notes = parseJson(res.text); } catch { box.innerHTML = '<p class="small" style="margin:0;color:var(--late)">התשובה לא הגיעה במבנה הנכון. נסה שוב.</p>'; return; }
    const list = (Array.isArray(notes) ? notes : []).filter(n => n && typeof n.text === 'string').slice(0, 6);
    box.innerHTML = (list.length ? `<ul class="notes">${list.map(n => `<li class="${n.level === 'warn' ? 'warn' : ''}">${esc(n.text)}</li>`).join('')}</ul>` : '<p class="small muted" style="margin:0">לא נמצאו הערות.</p>')
      + `<p class="small muted" style="margin:6px 0 0">${esc(providerLabel(prov))}, ${secs(res.ms)}. הערות בלבד, הן לא משנות את החישוב.</p>`;
  };

  // ---------- boot ----------
  writeForm(); renderPrices(); recompute();
  setBusy(true);
  $('provider-note').textContent = 'בודק אילו מודלים מותקנים…';
  api('/api/providers').then(list => {
    providers = list;
    const sel = $('provider');
    let saved = null; try { saved = localStorage.getItem('kb.provider'); } catch {}
    sel.innerHTML = list.map(p => `<option value="${p.id}" ${p.available ? '' : 'disabled'} title="${esc(p.reason || p.version || '')}">${esc(p.label)}${p.available ? '' : ' (לא נמצא)'}</option>`).join('');
    const first = list.find(p => p.available && p.id === saved) || list.find(p => p.available);
    if (first) sel.value = first.id;
    const n = list.filter(p => p.available).length;
    $('provider-note').textContent = n ? `${n} מתוך ${list.length} מודלים זמינים` : 'לא נמצא אף CLI מותקן. ראה README.';
    $('btn-compare').hidden = n < 2;
    setBusy(false);
  }).catch(() => {
    $('provider-note').textContent = 'השרת המקומי לא עונה. הרץ npm start ורענן.';
  });
  $('provider').onchange = e => { try { localStorage.setItem('kb.provider', e.target.value); } catch {} };
})();
