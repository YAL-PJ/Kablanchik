// מנוע חישוב דטרמיניסטי לשיפוץ חדר רחצה.
// פונקציה טהורה: אותו פרויקט + אותו מחירון => אותה הצעה.
const Engine = (() => {
  // ---------- קטלוג חומרים ----------
  // pack: יחידת אריזה, waste: פחת, lead: ימי אספקה, supplier: סוג ספק
  // orderAfter: חומר שאפשר להזמין רק אחרי סיום שלב (למשל מקלחון אחרי מדידה)
  const MATERIALS = {
    tile_floor:   { name: 'אריח רצפה', unit: 'מ"ר', pack: 1.44, packName: 'קרטון', waste: 0.10, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    tile_wall:    { name: 'אריח חיפוי', unit: 'מ"ר', pack: 1.08, packName: 'קרטון', waste: 0.10, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    adhesive:     { name: 'דבק אריחים C2TE', unit: 'ק"ג', pack: 25, packName: 'שק', waste: 0, lead: 1, supplier: 'חומרי בניין' },
    grout:        { name: 'רובה אפוקסית/צמנטית', unit: 'ק"ג', pack: 5, packName: 'דלי', waste: 0, lead: 1, supplier: 'חומרי בניין' },
    wp_cement:    { name: 'איטום צמנטי גמיש (ערכה)', unit: 'ק"ג', pack: 20, packName: 'ערכה', waste: 0.05, lead: 1, supplier: 'חומרי בניין' },
    wp_pu:        { name: 'איטום פוליאוריטני', unit: 'ק"ג', pack: 6, packName: 'דלי', waste: 0.05, lead: 2, supplier: 'חומרי בניין' },
    wp_tape:      { name: 'סרט איטום לפינות', unit: 'מ"א', pack: 10, packName: 'גליל', waste: 0.10, lead: 1, supplier: 'חומרי בניין' },
    screed:       { name: 'מדה מוכנה (שק 25 ק"ג)', unit: 'ק"ג', pack: 25, packName: 'שק', waste: 0.05, lead: 1, supplier: 'חומרי בניין' },
    plaster:      { name: 'טיח מוכן לתיקונים', unit: 'ק"ג', pack: 25, packName: 'שק', waste: 0.05, lead: 1, supplier: 'חומרי בניין' },
    pipe_kit:     { name: 'ערכת צנרת ואביזרים לנקודה', unit: 'נק\'', pack: 1, packName: 'ערכה', waste: 0, lead: 1, supplier: 'אינסטלציה' },
    elec_kit:     { name: 'ערכת חשמל לנקודה', unit: 'נק\'', pack: 1, packName: 'ערכה', waste: 0, lead: 1, supplier: 'חשמל' },
    cistern:      { name: 'מיכל הדחה סמוי', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    toilet_wall:  { name: 'אסלה תלויה + מושב', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    toilet_floor: { name: 'אסלה עומדת + מיכל', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    vanity:       { name: 'ארון אמבטיה + כיור', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 14, supplier: 'קרמיקה וכלים סניטריים' },
    shower_glass: { name: 'מקלחון זכוכית (לפי מידה)', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 10, supplier: 'זכוכית ומקלחונים', orderAfter: 'tiling' },
    bathtub:      { name: 'אמבטיה', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 7, supplier: 'קרמיקה וכלים סניטריים' },
    mixer_shower: { name: 'סוללה למקלחת (שקועה)', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    mixer_sink:   { name: 'ברז לכיור', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 5, supplier: 'קרמיקה וכלים סניטריים' },
    drain:        { name: 'תעלת ניקוז / מחסום רצפה', unit: 'יח\'', pack: 1, packName: 'יח\'', waste: 0, lead: 3, supplier: 'אינסטלציה' },
    gypsum:       { name: 'לוחות גבס ירוק + פרופילים', unit: 'מ"ר', pack: 1, packName: 'מ"ר', waste: 0.10, lead: 2, supplier: 'חומרי בניין' },
    silicone:     { name: 'סיליקון סניטרי', unit: 'יח\'', pack: 1, packName: 'שפופרת', waste: 0, lead: 1, supplier: 'חומרי בניין' },
  };

  // ---------- שלבים ----------
  // deps: שלבים שחייבים להסתיים קודם. wait: ימים קלנדריים של המתנה אחרי השלב (ייבוש/בדיקה)
  const PHASES = [
    { id: 'demo',        name: 'פירוק ופינוי',          deps: [] },
    { id: 'plumbing',    name: 'אינסטלציה',             deps: ['demo'] },
    { id: 'electrical',  name: 'חשמל',                  deps: ['demo'] },
    { id: 'plaster',     name: 'טיח ותיקוני קירות',     deps: ['plumbing', 'electrical'] },
    { id: 'screed',      name: 'מדה ושיפועים',          deps: ['plumbing'], wait: 3, waitName: 'ייבוש מדה' },
    { id: 'waterproof',  name: 'איטום',                 deps: ['screed', 'plaster'], wait: 2, waitName: 'בדיקת הצפה 48 שעות' },
    { id: 'tiling',      name: 'ריצוף וחיפוי',          deps: ['waterproof'], wait: 1, waitName: 'ייבוש רובה' },
    { id: 'ceiling',     name: 'תקרת גבס',              deps: ['tiling'] },
    { id: 'install',     name: 'התקנת כלים סניטריים',   deps: ['tiling', 'ceiling'] },
    { id: 'glass',       name: 'התקנת מקלחון',          deps: ['install'] },
    { id: 'finish',      name: 'סיליקון, ניקיון ומסירה', deps: ['install', 'glass'] },
  ];

  // ---------- מחירון לדוגמה (₪, לפני מע"מ) ----------
  const DEFAULT_PRICES = {
    labor: {
      demo_area: 60, waste_container: 1200, demo_fixtures: 600,
      plumb_point: 450, cistern_install: 600, elec_point: 250,
      plaster: 85, screed: 120, waterproof: 60,
      tile_floor: 130, tile_wall: 140, gypsum: 180,
      toilet_install: 350, vanity_install: 400, mixer_install: 200, bath_install: 600, glass_install: 0, drain_install: 250,
      finish: 500,
    },
    material: {
      tile_floor: 90, tile_wall: 80, adhesive: 55, grout: 45, wp_cement: 280, wp_pu: 350, wp_tape: 60,
      screed: 25, plaster: 35, pipe_kit: 180, elec_kit: 60, cistern: 1100, toilet_wall: 900, toilet_floor: 700,
      vanity: 1800, shower_glass: 2200, bathtub: 1500, mixer_shower: 900, mixer_sink: 400, drain: 450,
      gypsum: 60, silicone: 30,
    },
  };

  const LABOR_NAMES = {
    demo_area: ['פירוק ריצוף וחיפוי קיים', 'מ"ר'], waste_container: ['פינוי פסולת (מכולה)', 'יח\''],
    demo_fixtures: ['פירוק כלים סניטריים קיימים', 'קומפ\''],
    plumb_point: ['נקודות מים וביוב', 'נק\''], cistern_install: ['התקנת מיכל סמוי', 'יח\''],
    elec_point: ['נקודות חשמל (תאורה, שקע, מפוח)', 'נק\''],
    plaster: ['טיח ותיקוני קירות', 'מ"ר'], screed: ['מדה ושיפועים לניקוז', 'מ"ר'],
    waterproof: ['איטום רצפה וקירות רטובים', 'מ"ר'],
    tile_floor: ['ריצוף רצפה', 'מ"ר'], tile_wall: ['חיפוי קירות', 'מ"ר'], gypsum: ['תקרת גבס', 'מ"ר'],
    toilet_install: ['התקנת אסלה', 'יח\''], vanity_install: ['התקנת ארון וכיור', 'יח\''],
    mixer_install: ['התקנת סוללות וברזים', 'יח\''], bath_install: ['התקנת אמבטיה', 'יח\''],
    glass_install: ['התקנת מקלחון (ע"י הספק)', 'יח\''], drain_install: ['התקנת תעלת ניקוז', 'יח\''],
    finish: ['סיליקון, ניקיון ומסירה', 'קומפ\''],
  };

  // צריכת דבק לפי גודל אריח (ק"ג/מ"ר)
  function adhesiveRate(tile) {
    const [a, b] = String(tile || '60x60').split(/[x×*]/).map(Number);
    const big = Math.max(a || 60, b || 60);
    if (big >= 90) return 6;
    if (big >= 60) return 5;
    if (big >= 30) return 4;
    return 3.5;
  }
  function isLargeTile(tile) {
    const [a, b] = String(tile || '').split(/[x×*]/).map(Number);
    return Math.max(a || 0, b || 0) >= 90;
  }

  const r2 = n => Math.round(n * 100) / 100;

  // ---------- ולידציה ----------
  function validate(p) {
    const errors = [];
    const r = p.room || {};
    if (!(r.length > 0.8 && r.length < 8)) errors.push('אורך החדר חייב להיות בין 0.8 ל-8 מ\'');
    if (!(r.width > 0.8 && r.width < 8)) errors.push('רוחב החדר חייב להיות בין 0.8 ל-8 מ\'');
    if (!(r.height > 2 && r.height < 4)) errors.push('גובה תקרה חייב להיות בין 2 ל-4 מ\'');
    if (!(r.wallTileHeight > 0 && r.wallTileHeight <= r.height)) errors.push('גובה חיפוי חייב להיות חיובי ולא מעל גובה התקרה');
    if (!p.startDate || isNaN(Date.parse(p.startDate))) errors.push('תאריך התחלה חסר');
    return errors;
  }

  // ---------- גיאומטריה ----------
  function geometry(p) {
    const r = p.room;
    const floor = r.length * r.width;
    const perimeter = 2 * (r.length + r.width);
    const doorArea = (r.doorWidth || 0.8) * Math.min(r.doorHeight || 2.1, r.wallTileHeight);
    const winArea = (r.windowWidth || 0) * (r.windowHeight || 0);
    const wallTile = Math.max(0, perimeter * r.wallTileHeight - doorArea - winArea);
    const wallsFull = Math.max(0, perimeter * r.height - doorArea - winArea);
    // איטום: רצפה + רצועה היקפית 30 ס"מ + קירות אזור רחצה לגובה 2.0 מ' (2 קירות של 1 מ')
    const wetWall = p.spec.fixture === 'bath' ? (1.7 + 0.75) * 0.6 : 2 * 1.0 * 2.0;
    const waterproof = floor + perimeter * 0.3 + wetWall;
    return { floor: r2(floor), perimeter: r2(perimeter), wallTile: r2(wallTile), wallsFull: r2(wallsFull), waterproof: r2(waterproof) };
  }

  // ---------- עבודות (כמויות) ----------
  // כל עבודה: מפתח מחיר עבודה, כמות, שלב, תפוקה ליום, חומרים {key: כמות ביחידת החומר}
  function workItems(p, g) {
    const s = p.spec;
    const items = [];
    const add = (laborKey, qty, phase, perDay, materials = {}) => { if (qty > 0) items.push({ laborKey, qty: r2(qty), phase, perDay, materials }); };

    if (s.scope === 'full') {
      add('demo_area', g.floor + g.wallTile, 'demo', 20);
      add('demo_fixtures', 1, 'demo', 2);
      add('waste_container', 1, 'demo', 0);
    }

    // נקודות אינסטלציה: אסלה 2, כיור 3, מקלחת/אמבטיה 3, ניקוז רצפה 1
    const plumbPoints = s.newPlumbing ? 2 + (s.vanity ? 3 : 0) + 3 + 1 : 0;
    // סוללה שקועה נכנסת לקיר בשלב האינסטלציה, לכן נדרשת כבר אז
    add('plumb_point', plumbPoints, 'plumbing', 4, { pipe_kit: plumbPoints, ...(s.newPlumbing ? { mixer_shower: 1 } : {}) });
    if (s.toilet === 'wall') add('cistern_install', 1, 'plumbing', 2, { cistern: 1 });

    const elecPoints = s.newElectrical ? 4 : 0;
    add('elec_point', elecPoints, 'electrical', 6, { elec_kit: elecPoints });

    const plasterArea = s.scope === 'full' ? g.wallsFull * 0.3 : 0; // תיקונים בכ-30% מהקירות
    add('plaster', plasterArea, 'plaster', 15, { plaster: plasterArea * 8 });

    if (s.scope === 'full') add('screed', g.floor, 'screed', 15, { screed: g.floor * 80 }); // 4 ס"מ ≈ 80 ק"ג/מ"ר

    const wpRate = s.waterproofing === 'pu' ? 1.5 : 3;
    const wpKey = s.waterproofing === 'pu' ? 'wp_pu' : 'wp_cement';
    add('waterproof', g.waterproof, 'waterproof', 25, { [wpKey]: g.waterproof * wpRate, wp_tape: g.perimeter + 4 });

    const largeFloor = isLargeTile(s.floorTile);
    add('tile_floor', g.floor, 'tiling', largeFloor ? 8 : 12, {
      tile_floor: g.floor * (largeFloor ? 1.05 : 1),
      adhesive: g.floor * adhesiveRate(s.floorTile),
      grout: g.floor * 0.4,
    });
    add('tile_wall', g.wallTile, 'tiling', 10, {
      tile_wall: g.wallTile,
      adhesive: g.wallTile * adhesiveRate(s.wallTile),
      grout: g.wallTile * 0.4,
    });
    if (s.drain === 'channel' || s.scope === 'full') add('drain_install', 1, 'tiling', 0, { drain: 1 });

    if (s.ceiling === 'gypsum') add('gypsum', g.floor, 'ceiling', 12, { gypsum: g.floor });

    add('toilet_install', 1, 'install', 4, { [s.toilet === 'wall' ? 'toilet_wall' : 'toilet_floor']: 1 });
    if (s.vanity) add('vanity_install', 1, 'install', 3, { vanity: 1 });
    add('mixer_install', s.vanity ? 2 : 1, 'install', 4, { ...(s.newPlumbing ? {} : { mixer_shower: 1 }), ...(s.vanity ? { mixer_sink: 1 } : {}) });
    if (s.fixture === 'bath') add('bath_install', 1, 'install', 2, { bathtub: 1 });
    else add('glass_install', 1, 'glass', 2, { shower_glass: 1 });

    add('finish', 1, 'finish', 1, { silicone: 3 });
    return items;
  }

  // ---------- תאריכים (ימי עבודה א'-ה') ----------
  const DAY = 864e5;
  const parse = d => new Date(d + 'T00:00:00Z');
  const fmt = d => d.toISOString().slice(0, 10);
  const isWork = d => d.getUTCDay() <= 4; // 0=א' ... 4=ה'
  const nextWork = d => { let x = new Date(d); while (!isWork(x)) x = new Date(x.getTime() + DAY); return x; };
  const prevWork = d => { let x = new Date(d); while (!isWork(x)) x = new Date(x.getTime() - DAY); return x; };
  // סוף שלב שמתחיל ב-start ונמשך n ימי עבודה (כולל יום ההתחלה)
  const endAfter = (start, n) => { let x = nextWork(start), left = n - 1; while (left > 0) { x = new Date(x.getTime() + DAY); if (isWork(x)) left--; } return x; };
  const addWork = (d, n) => { let x = new Date(d), left = n; while (left > 0) { x = new Date(x.getTime() + DAY); if (isWork(x)) left--; } return x; };
  const subWork = (d, n) => { let x = new Date(d), left = n; while (left > 0) { x = new Date(x.getTime() - DAY); if (isWork(x)) left--; } return x; };
  const addCal = (d, n) => new Date(d.getTime() + n * DAY);

  // ---------- תזמון ----------
  function schedule(p, items, today) {
    const active = PHASES.filter(ph => items.some(i => i.phase === ph.id));
    const activeIds = new Set(active.map(a => a.id));
    // משך כל שלב = מקסימום מבין העבודות שבו (עבודות באותו שלב רצות במקביל עם צוות אחד => סכום)
    const days = {};
    for (const ph of active) {
      const sum = items.filter(i => i.phase === ph.id && i.perDay > 0).reduce((a, i) => a + i.qty / i.perDay, 0);
      days[ph.id] = Math.max(1, Math.ceil(sum - 1e-9));
    }
    const start0 = nextWork(parse(p.startDate));
    const result = {};
    // מיון טופולוגי פשוט לפי סדר PHASES (כבר מסודר)
    for (const ph of active) {
      let earliest = start0;
      for (const dep of ph.deps.filter(d => activeIds.has(d))) {
        const r = result[dep];
        const free = r.waitUntil ? r.waitUntil : addWork(r.end, 1);
        if (free > earliest) earliest = free;
      }
      // חומר שאפשר להזמין רק אחרי שלב קודם (מדידה) מעכב את השלב עד הגעתו
      for (const it of items.filter(i => i.phase === ph.id)) {
        for (const mk of Object.keys(it.materials)) {
          const m = MATERIALS[mk];
          if (m.orderAfter && result[m.orderAfter]) {
            const arrive = addWork(result[m.orderAfter].end, m.lead + 1);
            if (arrive > earliest) earliest = arrive;
          }
        }
      }
      const start = nextWork(earliest);
      const end = endAfter(start, days[ph.id]);
      const waitUntil = ph.wait ? nextWork(addCal(addWork(end, 1), ph.wait)) : null;
      result[ph.id] = { id: ph.id, name: ph.name, start, end, days: days[ph.id], wait: ph.wait || 0, waitName: ph.waitName, waitUntil };
    }
    const phases = active.map(ph => {
      const r = result[ph.id];
      return { ...r, start: fmt(r.start), end: fmt(r.end), waitUntil: r.waitUntil ? fmt(r.waitUntil) : null };
    });
    const last = phases[phases.length - 1];
    const finish = last.end;
    const workdays = countWork(parse(phases[0].start), parse(finish));
    return { phases, finish, workdays, raw: result };
  }
  function countWork(a, b) { let n = 0, x = new Date(a); while (x <= b) { if (isWork(x)) n++; x = new Date(x.getTime() + DAY); } return n; }

  // ---------- הזמנות חומרים ----------
  function orders(items, sched, prices, today) {
    const need = {}; // key -> {qty, phase}
    for (const it of items) for (const [mk, q] of Object.entries(it.materials)) {
      if (!need[mk]) need[mk] = { qty: 0, phases: [] };
      need[mk].qty += q;
      need[mk].phases.push(it.phase);
    }
    const lines = [];
    const todayD = today ? parse(today) : null;
    for (const [mk, n] of Object.entries(need)) {
      const m = MATERIALS[mk];
      const firstPhase = n.phases.map(id => sched.raw[id]).filter(Boolean).sort((a, b) => a.start - b.start)[0];
      const needBy = firstPhase.start;
      let orderBy, note = '';
      if (m.orderAfter && sched.raw[m.orderAfter]) {
        orderBy = addWork(sched.raw[m.orderAfter].end, 0);
        note = 'להזמין אחרי מדידה בסיום ' + sched.raw[m.orderAfter].name;
      } else {
        orderBy = prevWork(subWork(needBy, m.lead + 1)); // יום ביטחון
      }
      const deliverBy = prevWork(subWork(needBy, 1));
      const qtyWithWaste = n.qty * (1 + m.waste);
      const packs = Math.ceil(qtyWithWaste / m.pack - 1e-9);
      const unitPrice = prices.material[mk] ?? 0;
      // מחיר אריחים ליחידת מ"ר => מחיר לקרטון = מחיר × גודל אריזה
      // מחירי חומרים במחירון: אריחים וגבס למ"ר, כל השאר לאריזה
      const perPack = m.unit === 'מ"ר' ? unitPrice * m.pack : unitPrice;
      lines.push({
        key: mk, name: m.name, supplier: m.supplier,
        netQty: r2(n.qty), unit: m.unit, waste: m.waste, packs, packName: m.packName, packSize: m.pack,
        orderBy: fmt(orderBy), deliverBy: fmt(deliverBy), needBy: fmt(needBy), phase: firstPhase.name, lead: m.lead,
        late: todayD ? orderBy < todayD : false, note,
        packPrice: r2(perPack), total: r2(packs * perPack),
      });
    }
    lines.sort((a, b) => a.orderBy.localeCompare(b.orderBy) || a.supplier.localeCompare(b.supplier));
    return lines;
  }

  // ---------- הצעת מחיר ----------
  function quote(p, items, orderLines, prices) {
    const chapters = [];
    const byPhase = {};
    for (const ph of PHASES) byPhase[ph.id] = { phase: ph.id, name: ph.name, lines: [] };
    for (const it of items) {
      const [name, unit] = LABOR_NAMES[it.laborKey];
      const unitPrice = prices.labor[it.laborKey] ?? 0;
      byPhase[it.phase].lines.push({ kind: 'עבודה', name, qty: it.qty, unit, unitPrice, total: r2(it.qty * unitPrice) });
    }
    const markup = (p.materialMarkupPct || 0) / 100;
    for (const o of orderLines) {
      const phId = PHASES.find(ph => ph.name === o.phase).id;
      byPhase[phId].lines.push({ kind: 'חומר', name: o.name, qty: o.packs, unit: o.packName, unitPrice: r2(o.packPrice * (1 + markup)), total: r2(o.total * (1 + markup)) });
    }
    for (const ph of PHASES) {
      const c = byPhase[ph.id];
      if (!c.lines.length) continue;
      c.subtotal = r2(c.lines.reduce((a, l) => a + l.total, 0));
      chapters.push(c);
    }
    const labor = r2(chapters.flatMap(c => c.lines).filter(l => l.kind === 'עבודה').reduce((a, l) => a + l.total, 0));
    const material = r2(chapters.flatMap(c => c.lines).filter(l => l.kind === 'חומר').reduce((a, l) => a + l.total, 0));
    const net = r2(labor + material);
    const vat = r2(net * (p.vatPct ?? 18) / 100);
    return { chapters, labor, material, net, vat, total: r2(net + vat) };
  }

  function compute(project, prices = DEFAULT_PRICES, today) {
    const errors = validate(project);
    if (errors.length) return { errors };
    const g = geometry(project);
    const items = workItems(project, g);
    const sched = schedule(project, items, today);
    const ord = orders(items, sched, prices, today);
    const q = quote(project, items, ord, prices);
    const { raw, ...schedOut } = sched;
    return { errors: [], geometry: g, quote: q, schedule: schedOut, orders: ord };
  }

  const DEFAULT_PROJECT = {
    client: '', address: '', startDate: '', vatPct: 18, materialMarkupPct: 10,
    room: { length: 2.5, width: 2.0, height: 2.6, wallTileHeight: 2.6, doorWidth: 0.8, doorHeight: 2.1, windowWidth: 0.6, windowHeight: 0.6 },
    spec: { scope: 'full', floorTile: '60x60', wallTile: '30x60', fixture: 'shower', toilet: 'wall', vanity: true, waterproofing: 'cement', newPlumbing: true, newElectrical: true, ceiling: 'none', drain: 'channel' },
  };

  return { compute, validate, geometry, MATERIALS, PHASES, DEFAULT_PRICES, LABOR_NAMES, DEFAULT_PROJECT };
})();
if (typeof module !== 'undefined') module.exports = Engine;
