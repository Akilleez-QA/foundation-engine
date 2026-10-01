import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryLedger, type MaterialBatch } from './index';
const ore: MaterialBatch = { id: 'ore-1', material: 'iron', properties: { conductivity: 12, hardness: 5 } };
const part: MaterialBatch = { id: 'part-1', material: 'plate', properties: { strength: 8 } };
const options = { capacities: { bag: 10, bank: 20 } };
function loaded() {
  const l = createInventoryLedger(options);
  l.transact('load', [], [{ container: 'bag', batch: ore, quantity: 8 }]); return l;
}
test('inventory: atomic crafting failure consumes nothing; corrected retry succeeds once', () => {
  const l = loaded(), input = [{ container: 'bag', batchId: ore.id, quantity: 4 }];
  const before = l.snapshot();
  assert.deepEqual(l.transact('craft', input, [{ container: 'bag', batch: part, quantity: 7 }]), { ok: false, reason: 'capacity' });
  assert.deepEqual(l.snapshot(), before);
  const output = [{ container: 'bag', batch: part, quantity: 2 }];
  assert.deepEqual(l.transact('craft', input, output), { ok: true, duplicate: false });
  assert.deepEqual(l.transact('craft', input, output), { ok: true, duplicate: true });
  assert.equal(l.quantity('bag', ore.id), 4); assert.equal(l.quantity('bag', part.id), 2);
  assert.deepEqual(l.transact('craft', input, []), { ok: false, reason: 'conflict' });
});
test('inventory: transfer preserves material facts and cannot overdraw or rewrite identity', () => {
  const l = loaded();
  assert.equal(l.transfer('move', 'bag', 'bank', ore.id, 6).ok, true);
  assert.deepEqual(l.transfer('again', 'bag', 'bank', ore.id, 6), { ok: false, reason: 'insufficient' });
  assert.equal(l.quantity('bag', ore.id), 2); assert.equal(l.quantity('bank', ore.id), 6);
  assert.equal(l.material(ore.id)!.properties.hardness, 5);
  assert.deepEqual(l.transact('fake', [], [{ container: 'bag', batch: { ...ore, material: 'gold' }, quantity: 1 }]), { ok: false, reason: 'batch-conflict' });
  const clone = l.material(ore.id)!; clone.properties.hardness = 99;
  assert.equal(l.material(ore.id)!.properties.hardness, 5);
});
test('inventory: reservations prevent competing consumption and survive reload', () => {
  const l = loaded();
  assert.equal(l.reserve('hold', [{ container: 'bag', batchId: ore.id, quantity: 6 }]).ok, true);
  assert.equal(l.quantity('bag', ore.id), 8); assert.equal(l.available('bag', ore.id), 2);
  assert.deepEqual(l.transfer('steal', 'bag', 'bank', ore.id, 3), { ok: false, reason: 'insufficient' });
  const r = createInventoryLedger(options, l.snapshot());
  assert.equal(r.available('bag', ore.id), 2);
  assert.deepEqual(r.commitReservation('finish', 'hold', [{ container: 'bag', batch: part, quantity: 9 }]), { ok: false, reason: 'capacity' });
  assert.equal(r.available('bag', ore.id), 2);
  assert.equal(r.commitReservation('finish', 'hold', [{ container: 'bag', batch: part, quantity: 2 }]).ok, true);
  assert.equal(r.quantity('bag', ore.id), 2);
  assert.deepEqual(r.commitReservation('finish', 'hold', [{ container: 'bag', batch: part, quantity: 2 }]), { ok: true, duplicate: true });
  assert.deepEqual(r.release('release', 'hold'), { ok: false, reason: 'reservation' });
});
test('inventory: cancelled reservations release units without resurrecting on retry', () => {
  const l = loaded(), amounts = [{ container: 'bag', batchId: ore.id, quantity: 8 }];
  l.reserve('hold', amounts); l.release('cancel', 'hold');
  assert.equal(l.available('bag', ore.id), 8);
  assert.deepEqual(l.reserve('hold', amounts), { ok: true, duplicate: true });
  assert.equal(l.available('bag', ore.id), 8);
  assert.deepEqual(l.commitReservation('late', 'hold', []), { ok: false, reason: 'reservation' });
});
test('inventory: validates quantities, aggregate overdraw, capacity overflow and corrupted snapshots', () => {
  const l = loaded();
  for (const quantity of [0, -1, 0.1, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => l.transfer('bad', 'bag', 'bank', ore.id, quantity));
  const a = { container: 'bag', batchId: ore.id, quantity: 5 };
  assert.deepEqual(l.reserve('double', [a, a]), { ok: false, reason: 'insufficient' });
  assert.equal(l.available('bag', ore.id), 8);
  const snap = l.snapshot(); snap.operations.push({ kind: 'exchange', id: 'bad', consume: [a, a], produce: [] });
  assert.throws(() => createInventoryLedger(options, snap));
  const huge = createInventoryLedger({ capacities: { bag: Number.MAX_SAFE_INTEGER } });
  huge.transact('full', [], [{ container: 'bag', batch: ore, quantity: Number.MAX_SAFE_INTEGER }]);
  assert.deepEqual(huge.transact('overflow', [], [{ container: 'bag', batch: ore, quantity: 1 }]), { ok: false, reason: 'capacity' });
  assert.equal(huge.quantity('bag', ore.id), Number.MAX_SAFE_INTEGER);
});
test('inventory: detached snapshots retain retry receipts across reload', () => {
  const l = loaded(); l.transfer('move', 'bag', 'bank', ore.id, 4);
  const r = createInventoryLedger(options, l.snapshot());
  assert.deepEqual(r.transfer('move', 'bag', 'bank', ore.id, 4), { ok: true, duplicate: true });
  const s = r.snapshot(); s.capacities.bag = 1000;
  s.operations.length = 0;
  assert.equal(r.quantity('bank', ore.id), 4);
  assert.throws(() => createInventoryLedger({ capacities: { bag: -1 } }));
});
