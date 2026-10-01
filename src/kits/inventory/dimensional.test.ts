import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDimensionalStock, prepareStockChange, type DimensionalStock, type StockBatch, type StockBounds } from './dimensional';
const bounds: StockBounds = { containers: 8, batches: 16, positions: 32, changes: 32, properties: 8 };
const ore: StockBatch = { id: 'ore-a', material: 'ore', unit: 'g', phase: 'solid', massMg: 1000, volumeUl: 625, properties: { iron: .25 } };
const base = (): DimensionalStock => ({ version: 1,
  containers: [{ id: 'rover', maxMassMg: 100000000, maxVolumeUl: 100000000, phases: ['solid'] }, { id: 'hopper', maxMassMg: 100000000, maxVolumeUl: 100000000, phases: ['solid'] }],
  batches: [ore], positions: [{ container: 'rover', batch: ore.id, quantity: 72000 }] });
const run = (state: DimensionalStock, change: Parameters<typeof prepareStockChange>[1], b = bounds) => prepareStockChange(state, change, b);
describe('dimensional stock candidate preparation', () => {
  it('transfers cargo preserving exact batch and leaves the source envelope untouched', () => {
    const state = base(), before = structuredClone(state);
    const result = run(state, { consume: [{ container: 'rover', batch: ore.id, quantity: 72000 }], produce: [{ container: 'hopper', batch: ore.id, quantity: 72000 }] });
    assert.equal(result.ok, true); assert.deepEqual(state, before);
    if (!result.ok) return;
    assert.equal(result.consumedMassMg, 72000000); assert.equal(result.producedMassMg, 72000000);
    assert.deepEqual(result.state.positions, [{ container: 'hopper', batch: ore.id, quantity: 72000 }]);
    result.state.batches[0]!.properties.iron = 9;
    assert.equal(state.batches[0]!.properties.iron, .25);
  });
  it('adds storage and transfers into it in one candidate; failed volume admission rolls back all work', () => {
    const state = base(), change = { addContainers: [{ id: 'new', maxMassMg: 100000000, maxVolumeUl: 10, phases: ['solid'] }],
      consume: [{ container: 'rover', batch: ore.id, quantity: 1 }], produce: [{ container: 'new', batch: ore.id, quantity: 1 }] };
    assert.deepEqual(run(state, change), { ok: false, reason: 'capacity' });
    assert.equal((state.containers).length, 2); assert.equal(state.positions[0]!.quantity, 72000);
    change.addContainers[0]!.maxVolumeUl = 625;
    const result = run(state, change); assert.equal(result.ok, true);
    if (result.ok) assert.equal((result.state.containers).length, 3);
  });
  it('atomically produces multiple streams and refuses a missing waste destination', () => {
    const state = base(), iron = { ...ore, id: 'iron', material: 'iron', volumeUl: 128 }, residue = { ...ore, id: 'residue', material: 'residue' };
    const change = { issueBatches: [iron, residue], consume: [{ container: 'rover', batch: ore.id, quantity: 100 }],
      produce: [{ container: 'hopper', batch: iron.id, quantity: 25 }, { container: 'waste', batch: residue.id, quantity: 75 }] };
    assert.deepEqual(run(state, change), { ok: false, reason: 'unknown' });
    assert.equal((state.batches).length, 1);
    const result = run(state, { ...change, addContainers: [{ id: 'waste', maxMassMg: 75000, maxVolumeUl: 46875, phases: ['solid'] }] });
    assert.equal(result.ok, true); if (result.ok) assert.equal(result.producedMassMg, result.consumedMassMg);
  });
  it('checks final capacity after all consumes, while never borrowing produced stock to fund consumption', () => {
    const state = base(); state.containers[0]!.maxMassMg = 72000000;
    assert.equal(run(state, { consume: [{ container: 'rover', batch: ore.id, quantity: 1 }], produce: [{ container: 'rover', batch: ore.id, quantity: 1 }] }).ok, true);
    assert.deepEqual(run(state, { consume: [{ container: 'hopper', batch: ore.id, quantity: 1 }], produce: [{ container: 'hopper', batch: ore.id, quantity: 1 }] }), { ok: false, reason: 'insufficient' });
  });
  it('aggregates repeated consumption and rejects overspending atomically', () => {
    const state = base();
    assert.deepEqual(run(state, { consume: [{ container: 'rover', batch: ore.id, quantity: 40000 }, { container: 'rover', batch: ore.id, quantity: 40000 }] }), { ok: false, reason: 'insufficient' });
    assert.equal(state.positions[0]!.quantity, 72000);
  });
  it('rejects phase mismatch, mutation of issued identity and unsafe arithmetic', () => {
    assert.deepEqual(run(base(), { issueBatches: [{ ...ore, massMg: 9 }] }), { ok: false, reason: 'identity' });
    const gas = { ...ore, id: 'gas', phase: 'gas' };
    assert.deepEqual(run(base(), { issueBatches: [gas], produce: [{ container: 'hopper', batch: 'gas', quantity: 1 }] }), { ok: false, reason: 'phase' });
    assert.deepEqual(run(base(), { produce: [{ container: 'hopper', batch: ore.id, quantity: Number.MAX_SAFE_INTEGER }] }), { ok: false, reason: 'capacity' });
  });
  it('can remove storage only after evacuation and refuses shrink below actual contents', () => {
    assert.deepEqual(run(base(), { removeContainers: ['rover'] }), { ok: false, reason: 'occupied' });
    assert.deepEqual(run(base(), { resizeContainers: [{ id: 'rover', maxMassMg: 1, maxVolumeUl: 1 }] }), { ok: false, reason: 'capacity' });
    const result = run(base(), { consume: [{ container: 'rover', batch: ore.id, quantity: 72000 }], produce: [{ container: 'hopper', batch: ore.id, quantity: 72000 }], removeContainers: ['rover'] });
    assert.equal(result.ok, true); if (result.ok) assert.deepEqual(result.state.containers.map(c => c.id), ['hopper']);
  });
  it('bounds commands, retained records and properties without changing accepted state', () => {
    assert.equal(run(base(), {}, { ...bounds, positions: 1 }).ok, true);
    assert.deepEqual(run(base(), { produce: [{ container: 'hopper', batch: ore.id, quantity: 1 }] }, { ...bounds, positions: 1 }), { ok: false, reason: 'limit' });
    assert.deepEqual(run(base(), { consume: [{ container: 'rover', batch: ore.id, quantity: 1 }], produce: [{ container: 'hopper', batch: ore.id, quantity: 1 }] }, { ...bounds, changes: 1 }), { ok: false, reason: 'limit' });
    assert.deepEqual(run(base(), { issueBatches: [{ ...ore, id: 'extra', properties: { a: 1, b: 2 } }] }, { ...bounds, properties: 1 }), { ok: false, reason: 'limit' });
  });
  it('restores canonical isolated data and rejects corrupt duplicate/unknown/overfull snapshots', () => {
    const state = base(); assert.deepEqual(parseDimensionalStock(JSON.parse(JSON.stringify(state)), bounds), parseDimensionalStock(state, bounds));
    state.positions.push({ ...state.positions[0]! }); assert.throws(() => parseDimensionalStock(state, bounds));
    const other = base(); other.positions[0]!.container = 'missing'; assert.throws(() => parseDimensionalStock(other, bounds));
    const over = base(); over.containers[0]!.maxVolumeUl = 1; assert.throws(() => parseDimensionalStock(over, bounds));
  });
  it('treats special identifiers as data rather than object prototype keys', () => {
    const state = base(); state.containers[0]!.id = '__proto__'; state.positions[0]!.container = '__proto__';
    assert.equal(run(state, { consume: [{ container: '__proto__', batch: ore.id, quantity: 1 }] }).ok, true);
  });
  it('rejects sparse arrays instead of admitting state that changes meaning after JSON restore', () => {
    for (const field of ['containers', 'batches', 'positions'] as const) {
      const state = base(); (state[field] as unknown[]) = new Array(1);
      assert.deepEqual(run(state, {}), { ok: false, reason: 'invalid' });
    }
    const bad = base(); bad.containers[0]!.phases = new Array(1);
    assert.deepEqual(run(bad, {}), { ok: false, reason: 'invalid' });
    for (const field of ['addContainers', 'resizeContainers', 'removeContainers', 'issueBatches', 'consume', 'produce'] as const) {
      assert.deepEqual(run(base(), { [field]: new Array(1) }), { ok: false, reason: 'invalid' });
    }
    const good = run(base(), {});
    assert.equal(good.ok, true);
    if (good.ok) assert.deepEqual(parseDimensionalStock(JSON.parse(JSON.stringify(good.state)), bounds), good.state);
  });

  it('ignores caller iterators when capturing bounded arrays', () => {
    const s = base(); let called = false;
    Object.defineProperty(s.containers, Symbol.iterator, { value: function* () { called = true; for (let i = 0; i < 99; i++) yield { ...s.containers[0]!, id: String(i) }; } });
    const parsed = parseDimensionalStock(s, bounds); assert.equal(parsed.containers.length, 2); assert.equal(called, false);
  });

});
