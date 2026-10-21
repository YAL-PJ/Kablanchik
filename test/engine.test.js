const E = require('../public/engine.js');
const assert = require('assert');
const clone = o => JSON.parse(JSON.stringify(o));
const p = clone(E.DEFAULT_PROJECT); p.startDate = '2026-11-01';
const r = E.compute(p, E.DEFAULT_PRICES, '2026-10-19');
console.log(r.geometry);
for (const c of r.quote.chapters) { console.log('##', c.name, c.subtotal); for (const l of c.lines) console.log('   ', l.kind, l.name, l.qty, l.unit, l.unitPrice, l.total); }
console.log('labor', r.quote.labor, 'mat', r.quote.material, 'net', r.quote.net, 'vat', r.quote.vat, 'total', r.quote.total);
for (const ph of r.schedule.phases) console.log(ph.name, ph.start, ph.end, ph.days, ph.waitUntil || '');
console.log('finish', r.schedule.finish, 'workdays', r.schedule.workdays);
for (const o of r.orders) console.log(o.orderBy, o.name, o.packs, o.packName, 'need', o.needBy, o.late ? 'LATE' : '', o.note, o.total);

const g = r.geometry;
assert.strictEqual(g.floor, 5); assert.strictEqual(g.perimeter, 9);
assert.strictEqual(g.wallTile, 21.36); // 9*2.6 - 0.8*2.1 - 0.36
assert.strictEqual(r.orders.find(o => o.key === 'tile_floor').packs, 4); // 5*1.1/1.44=3.82
assert.strictEqual(r.orders.find(o => o.key === 'tile_wall').packs, 22); // 21.36*1.1/1.08=21.76
for (const ph of r.schedule.phases) for (const d of [ph.start, ph.end]) assert(new Date(d + 'T00:00:00Z').getUTCDay() <= 4, 'weekend ' + ph.name + d);
const S = Object.fromEntries(r.schedule.phases.map(x => [x.id, x]));
for (const ph of E.PHASES) if (S[ph.id]) for (const d of ph.deps) if (S[d]) {
  const free = S[d].waitUntil || S[d].end;
  assert(S[ph.id].start > S[d].end && S[ph.id].start >= free, ph.id + ' must start after ' + d);
}
for (const o of r.orders) assert(o.note || o.orderBy < o.needBy, 'order before need ' + o.name);
const sum = r.quote.chapters.reduce((a, c) => a + c.subtotal, 0);
assert(Math.abs(sum - r.quote.net) < 0.05, 'chapters sum to net');
assert(Math.abs(r.quote.vat - r.quote.net * 0.18) < 0.01);
assert.deepStrictEqual(E.compute(p, E.DEFAULT_PRICES, '2026-10-19'), r, 'deterministic');

const b = clone(p); b.spec.fixture = 'bath'; b.spec.scope = 'partial'; b.spec.toilet = 'floor';
const rb = E.compute(b, E.DEFAULT_PRICES, '2026-10-19');
assert(!rb.schedule.phases.find(x => x.id === 'glass'));
console.log('bath/partial total', rb.quote.total, rb.schedule.finish, rb.schedule.phases.map(x => x.id).join(','));

const bad = clone(p); bad.room.length = 0; assert(E.compute(bad).errors.length > 0);
const late = E.compute(p, E.DEFAULT_PRICES, '2026-10-29');
console.log('late on 10-29:', late.orders.filter(o => o.late).map(o => o.name));
console.log('ALL OK');
